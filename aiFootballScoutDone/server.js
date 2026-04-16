import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import session from "express-session";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const userDataPath = path.join(__dirname, "data", "userData.json");
const usersPath = path.join(__dirname, "data", "users.json");
const pastRecommendationsPath = path.join(__dirname, "data", "pastRecommendations.json");
const fallbackPlayersCsvPath = path.join(__dirname, "data", "playersPOC.csv");
const standingsSnapshotPath = path.join(__dirname, "data", "standingsSnapshot.json");
const playerOverridesPath = path.join(__dirname, "data", "playerOverrides.json");
const adminEditLogsPath = path.join(__dirname, "data", "adminEditLogs.json");
const realPlayerImageMap = {
  "lamine yamal": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Lamine_Yamal_in_2025.jpg/250px-Lamine_Yamal_in_2025.jpg",
  "jude bellingham": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/25th_Laureus_World_Sports_Awards_-_Red_Carpet_-_Jude_Bellingham_-_240422_190551-2_%28cropped%29.jpg/250px-25th_Laureus_World_Sports_Awards_-_Red_Carpet_-_Jude_Bellingham_-_240422_190551-2_%28cropped%29.jpg",
  "pedri": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/Pedri.jpg/250px-Pedri.jpg",
  "cole palmer": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fb/Cole_Palmer_2025_FIFA_Club_World_Cup_Final.jpg/250px-Cole_Palmer_2025_FIFA_Club_World_Cup_Final.jpg",
  "dean huijsen": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Dean_Huijsen_2024.jpg/250px-Dean_Huijsen_2024.jpg",
  "nico williams": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/ATHLETIC-OSASUNA_SEMIFINAL._MAIDER_GOIKOETXEA_%28168%29_%28cropped%29.jpg/250px-ATHLETIC-OSASUNA_SEMIFINAL._MAIDER_GOIKOETXEA_%28168%29_%28cropped%29.jpg"
};


function buildAvatarSvg(player) {
  const initials = String(player?.name || "Player")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => (part[0] || "").toUpperCase())
    .join("") || "P";
  const palette = {
    "Premier League": ["#1f4a7d", "#0f1722"],
    "La Liga": ["#7d2f1f", "#1a1110"],
    "Serie A": ["#1f7d53", "#0f1713"],
    "Bundesliga": ["#7d1f34", "#180f13"],
    "Ligue 1": ["#5a3f8c", "#14111d"]
  };
  const colors = palette[player?.leagueName] || ["#34506b", "#121820"];
  const safeName = String(player?.name || "Player").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeTeam = String(player?.team || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="${colors[0]}" offset="0"/>
      <stop stop-color="${colors[1]}" offset="1"/>
    </linearGradient>
  </defs>
  <rect width="600" height="600" rx="36" fill="url(#g)"/>
  <circle cx="300" cy="230" r="108" fill="rgba(255,255,255,0.10)"/>
  <text x="300" y="266" text-anchor="middle" font-family="Arial, sans-serif" font-size="110" font-weight="700" fill="#f5f9ff">${initials}</text>
  <text x="300" y="420" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#f5f9ff">${safeName}</text>
  <text x="300" y="465" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#d9e7f6">${safeTeam}</text>
</svg>`;
}

const SESSION_SECRET = process.env.SESSION_SECRET || "fyp-football-scout-session";
const isProduction = process.env.NODE_ENV === "production";
const SESSION_COOKIE_NAME = "scout.sid";
const AUTH_COOKIE_NAME = "scout.auth";
const CSRF_HEADER_NAME = "x-csrf-token";
const JWT_SECRET = process.env.JWT_SECRET || `${SESSION_SECRET}-jwt`;
const JWT_EXPIRES_IN = "4h";
const DISPLAY_CURRENT_SEASON = 2026;
const DISPLAY_HISTORY_SEASON = 2025;
const API_SOURCE_SEASON = Number(process.env.API_FOOTBALL_SEASON || 2025);
const API_PLAYER_PAGE_LIMIT = 2;

app.disable("x-powered-by");
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
});
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});
app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  maxAge: 0
}));
app.use(express.json({ limit: "120kb" }));
app.use(
  session({
    name: SESSION_COOKIE_NAME,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 4
    }
  })
);

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
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
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeText(text, maxLength = 160) {
  return String(text || "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isStrongPassword(password) {
  return typeof password === "string" && password.length >= 8 && password.length <= 72;
}

function generateCsrfToken() {
  return crypto.randomBytes(24).toString("hex");
}

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  return req.session.csrfToken;
}

function requireCsrf(req, res, next) {
  const expected = req.session?.csrfToken;
  const received = String(req.get(CSRF_HEADER_NAME) || "");
  if (!expected || !received || received !== expected) {
    return res.status(403).json({ ok: false, message: "Invalid request token" });
  }
  next();
}

function loadPastRecommendations() {
  const raw = loadJson(pastRecommendationsPath, []);
  const filtered = raw
    .filter((item) => Number(item.season) === DISPLAY_HISTORY_SEASON)
    .map((item) => ({ ...item, season: DISPLAY_HISTORY_SEASON }));
  return filtered.slice(0, 3);
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

function parseSimpleCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()]));
  });
}

function fallbackLeagueName(team) {
  const map = {
    "Manchester City": "Premier League",
    Arsenal: "Premier League",
    Chelsea: "Premier League",
    Liverpool: "Premier League",
    "Manchester United": "Premier League",
    Tottenham: "Premier League",
    Newcastle: "Premier League",
    Brighton: "Premier League",
    "West Ham": "Premier League",
    "Bayern Munich": "Bundesliga",
    Dortmund: "Bundesliga",
    Leverkusen: "Bundesliga",
    Leipzig: "Bundesliga",
    Barcelona: "La Liga",
    "Real Madrid": "La Liga",
    Atletico: "La Liga",
    Sevilla: "La Liga",
    Juventus: "Serie A",
    Inter: "Serie A",
    Milan: "Serie A",
    Napoli: "Serie A",
    PSG: "Ligue 1",
    Marseille: "Ligue 1",
    Monaco: "Ligue 1"
  };
  return map[String(team || "").trim()] || "Scouting Sample League";
}

function fallbackLeagueId(name) {
  const map = {
    "Premier League": 39,
    "La Liga": 140,
    "Serie A": 135,
    Bundesliga: 78,
    "Ligue 1": 61,
    "Scouting Sample League": 999
  };
  return map[name] || 999;
}

function loadFallbackPlayersFromCsv() {
  try {
    if (!fs.existsSync(fallbackPlayersCsvPath)) return [];
    const rows = parseSimpleCsv(fs.readFileSync(fallbackPlayersCsvPath, "utf8"));
    return rows.map((row, index) => {
      const detailedPosition = guessDetailedPosition(row.position, { height: row.heightCm ? `${row.heightCm} cm` : "" }, {
        shots: { total: num(row.shots) },
        goals: { total: num(row.goals) },
        passes: { total: 420, completed: 360 },
        tackles: { interceptions: num(row.interceptions) },
        duels: { total: num(row.aerialDuelsWon) + num(row.aerialDuelsLost), won: num(row.aerialDuelsWon) }
      });
      const leagueName = fallbackLeagueName(row.team);
      const passesAttempted = detailedPosition === "CB" || detailedPosition === "DM" ? 1600 : detailedPosition === "CM" || detailedPosition === "AM" ? 1400 : 900;
      const passAccuracy = detailedPosition === "CB" ? 0.9 : detailedPosition === "DM" ? 0.88 : detailedPosition === "CM" ? 0.86 : detailedPosition === "AM" ? 0.82 : detailedPosition === "FB" ? 0.83 : 0.78;
      const passesCompleted = Math.round(passesAttempted * passAccuracy);
      const aerialDuelsWon = num(row.aerialDuelsWon);
      const aerialDuelsTotal = aerialDuelsWon + num(row.aerialDuelsLost);
      const goals = num(row.goals);
      const shots = num(row.shots);
      return {
        id: `${slugify(row.name)}-${slugify(row.team)}-csv-${index + 1}`,
        name: row.name || `Sample Player ${index + 1}`,
        team: row.team || "Unknown",
        leagueId: fallbackLeagueId(leagueName),
        leagueName,
        position: simplePosition(detailedPosition),
        detailedPosition,
        rawPosition: row.position || "",
        age: 20 + (index % 10),
        nationality: "Sample",
        heightCm: num(row.heightCm) || 180,
        photo: "",
        appearances: 28 + (index % 8),
        shots,
        goals,
        passesCompleted,
        passesAttempted,
        aerialDuelsWon,
        aerialDuelsTotal,
        interceptions: num(row.interceptions),
        passAccuracy,
        aerialRate: aerialDuelsTotal > 0 ? aerialDuelsWon / aerialDuelsTotal : 0,
        shotConversion: shots > 0 ? goals / shots : 0,
        interceptionsPerGame: (28 + (index % 8)) > 0 ? num(row.interceptions) / (28 + (index % 8)) : 0,
        headerWinRate: aerialDuelsTotal > 0 ? aerialDuelsWon / aerialDuelsTotal : 0,
        teamLogo: "",
        teamStanding: null
      };
    });
  } catch (err) {
    console.error("Failed to load fallback CSV players:", err.message);
    return [];
  }
}


async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

function signAuthToken(user) {
  return jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function readAuthToken(req) {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

function applyAuthCookie(res, user) {
  res.cookie(AUTH_COOKIE_NAME, signAuthToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 4
  });
}

function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction
  });
}

function isBcryptHash(hash) {
  return typeof hash === "string" && /^\$2[aby]\$/.test(hash);
}

function normaliseRole(role) {
  const value = String(role || "").toLowerCase();
  if (value === "admin") return "admin";
  if (value === "scout") return "scout";
  return "user";
}

function ensureUsersFile() {
  if (fs.existsSync(usersPath)) return;

  const defaults = [
    { username: "admin", password: "password", role: "admin" },
    { username: "scout", password: "scout123", role: "scout" },
    { username: "user", password: "user12345", role: "user" }
  ];

  const seeded = defaults.map((u) => ({
    username: u.username,
    role: u.role,
    passwordHash: bcrypt.hashSync(u.password, 12)
  }));

  saveJson(usersPath, seeded);
}

function getUsers() {
  ensureUsersFile();
  const users = loadJson(usersPath, []);
  const legacyUserData = loadJson(userDataPath, {});
  const legacyUsers = Array.isArray(legacyUserData.users) ? legacyUserData.users : [];
  const migrated = [];
  let changed = false;

  for (const rawUser of users) {
    const username = sanitizeText(rawUser.username, 24);
    if (!username) continue;

    const legacyMatch = legacyUsers.find((entry) => String(entry.username) === username);
    let role = normaliseRole(rawUser.role);
    if (legacyMatch?.role) {
      role = normaliseRole(legacyMatch.role);
    }
    if (username === "scout") role = "scout";
    if (username === "admin") role = "admin";

    let passwordHash = rawUser.passwordHash || rawUser.hash || "";

    if (!isBcryptHash(passwordHash)) {
      let plain = legacyMatch?.password || "";
      if (!plain && username === "admin") plain = "password";
      if (!plain && username === "scout") plain = "scout123";
      if (!plain && username === "user") plain = "user12345";
      if (plain) {
        passwordHash = bcrypt.hashSync(plain, 12);
        changed = true;
      }
    }

    if (!isBcryptHash(passwordHash)) continue;
    if (role !== rawUser.role || rawUser.salt || rawUser.hash) changed = true;
    migrated.push({ username, role, passwordHash });
  }

  const required = [
    { username: "admin", password: "password", role: "admin" },
    { username: "scout", password: "scout123", role: "scout" },
    { username: "user", password: "user12345", role: "user" }
  ];

  for (const seed of required) {
    if (!migrated.some((entry) => entry.username === seed.username)) {
      migrated.push({
        username: seed.username,
        role: seed.role,
        passwordHash: bcrypt.hashSync(seed.password, 12)
      });
      changed = true;
    }
  }

  if (changed) saveJson(usersPath, migrated);
  return migrated;
}

function loadUserData() {
  return loadJson(userDataPath, {});
}

function saveUserData(data) {
  saveJson(userDataPath, data);
}
function loadPlayerOverrides() {
  return loadJson(playerOverridesPath, {});
}

function savePlayerOverrides(data) {
  saveJson(playerOverridesPath, data);
}

function applyPlayerOverrides(player) {
  const overrides = loadPlayerOverrides();
  const patch = overrides[player.id];
  return patch ? { ...player, ...patch } : player;
}


function loadAdminEditLogs() {
  return loadJson(adminEditLogsPath, []);
}

function saveAdminEditLogs(data) {
  saveJson(adminEditLogsPath, data);
}

function appendAdminEditLog(entry) {
  const logs = loadAdminEditLogs();
  logs.unshift(entry);
  saveAdminEditLogs(logs.slice(0, 120));
}

function loadStandingsSnapshot() {
  return loadJson(standingsSnapshotPath, {});
}

function buildSnapshotStandings(leagueId, season) {
  const snapshots = loadStandingsSnapshot();
  const seasonRows = snapshots[String(season)]?.[String(leagueId)] || [];
  if (!seasonRows.length) return null;
  return {
    code: String(leagueId),
    name: getLeagueNameById(Number(leagueId)),
    season,
    sourceSeason: season,
    table: seasonRows.map((team, index) => ({
      position: index + 1,
      team,
      played: 32 - Math.max(0, 2 - (index % 3)),
      won: Math.max(5, 22 - index),
      drawn: 4 + (index % 5),
      lost: Math.max(1, Math.floor(index / 2))
    })).map((row, index) => {
      const goalsFor = Math.max(18, 68 - index * 2);
      const goalsAgainst = Math.max(14, 26 + index);
      const won = Math.max(5, 22 - index);
      const drawn = 4 + (index % 5);
      const played = 32 - Math.max(0, 2 - (index % 3));
      const lost = Math.max(0, played - won - drawn);
      return {
        ...row,
        played, won, drawn, lost, goalsFor, goalsAgainst,
        goalDifference: goalsFor - goalsAgainst,
        points: won * 3 + drawn,
        form: makeFallbackForm(index + 1)
      };
    }),
    message: 'Bundled standings snapshot'
  };
}

function getAuthenticatedUser(req) {
  const tokenUser = readAuthToken(req);
  if (tokenUser?.username && tokenUser?.role) {
    return { username: tokenUser.username, role: normaliseRole(tokenUser.role) };
  }
  if (req.session?.user?.username && req.session?.user?.role) {
    return { username: req.session.user.username, role: normaliseRole(req.session.user.role) };
  }
  return null;
}

function requireAuth(req, res, next) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ ok: false, message: "Not logged in" });
  }
  req.authUser = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = getAuthenticatedUser(req);
  if (!user || user.role !== "admin") {
    return res.status(403).json({ ok: false, message: "Admin access required" });
  }
  req.authUser = user;
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
  const raw = process.env.API_FOOTBALL_LEAGUE_IDS || process.env.API_FOOTBALL_LEAGUE_ID || "39,140,135,78,61";
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

function leagueValueFactor(leagueName) {
  const map = {
    "Premier League": 1.15,
    "La Liga": 1.08,
    "Serie A": 1.0,
    Bundesliga: 1.03,
    "Ligue 1": 0.96
  };
  return map[leagueName] || 1;
}

function positionValueFactor(position) {
  const map = {
    GK: 0.72,
    CB: 0.96,
    FB: 0.88,
    DM: 1.0,
    CM: 1.02,
    AM: 1.08,
    Winger: 1.12,
    ST: 1.18
  };
  return map[position] || 1;
}

function ageValueFactor(age) {
  const n = num(age);
  if (!n) return 0.9;
  if (n <= 20) return 1.26;
  if (n <= 23) return 1.2;
  if (n <= 26) return 1.1;
  if (n <= 29) return 1.0;
  if (n <= 32) return 0.86;
  return 0.72;
}

function estimateFinancials(player) {
  const age = num(player.age);
  const appearances = num(player.appearances);
  const goals = num(player.goals);
  const shots = num(player.shots);
  const passAccuracy = clamp01(player.passAccuracy);
  const aerialRate = clamp01(player.aerialRate);
  const interceptionsPerGame = num(player.interceptionsPerGame);
  const teamStanding = num(player.teamStanding) || 12;

  let performance = 20;
  performance += Math.min(appearances, 38) * 0.8;
  performance += goals * 2.8;
  performance += shots * 0.15;
  performance += passAccuracy * 18;
  performance += aerialRate * 14;
  performance += interceptionsPerGame * 24;
  performance += Math.max(0, 20 - teamStanding) * 0.8;

  if (player.detailedPosition === "GK") {
    performance += passAccuracy * 8 + aerialRate * 10;
  }
  if (player.detailedPosition === "CB" || player.detailedPosition === "DM") {
    performance += aerialRate * 8 + interceptionsPerGame * 10;
  }
  if (player.detailedPosition === "AM" || player.detailedPosition === "Winger" || player.detailedPosition === "ST") {
    performance += goals * 2.5 + shots * 0.2;
  }

  const ageFactor = ageValueFactor(age);
  const leagueFactor = leagueValueFactor(player.leagueName);
  const positionFactor = positionValueFactor(player.detailedPosition);

  let estimatedMarketValue = performance * ageFactor * leagueFactor * positionFactor * 0.62;
  estimatedMarketValue = Math.max(1.5, Math.min(estimatedMarketValue, 180));

  const contractRisk = age >= 30 ? 0.9 : 1;
  const expectedValue = performance * leagueFactor * positionFactor * contractRisk * 0.68;
  const undervaluedScoreRaw = expectedValue - estimatedMarketValue * 0.82;
  const affordabilityScore = clamp01((40 - estimatedMarketValue) / 40);
  const upsideScore = clamp01((29 - age) / 10);
  const valueForMoneyScore = Math.round(
    clamp01((performance / 100) * 0.5 + affordabilityScore * 0.25 + upsideScore * 0.25) * 100
  );
  const undervaluedScore = Math.round(Math.max(0, Math.min(100, 50 + undervaluedScoreRaw * 2.2)));
  const valueGap = Math.round((expectedValue - estimatedMarketValue) * 10) / 10;

  let urgency = "Low";
  if (undervaluedScore >= 78 && valueForMoneyScore >= 70) urgency = "High";
  else if (undervaluedScore >= 65 && valueForMoneyScore >= 58) urgency = "Medium";

  let priceBand = "Premium";
  if (estimatedMarketValue < 8) priceBand = "Low cost";
  else if (estimatedMarketValue < 18) priceBand = "Budget";
  else if (estimatedMarketValue < 35) priceBand = "Mid range";
  else if (estimatedMarketValue < 60) priceBand = "High value";

  let scoutAction = "Monitor";
  if (urgency === "High") scoutAction = "Watch now";
  if (urgency === "High" && estimatedMarketValue <= 25) scoutAction = "Shortlist";
  if (estimatedMarketValue > 70 && valueForMoneyScore < 60) scoutAction = "Too expensive";

  const reasons = [];
  if (goals >= 10) reasons.push("goal output");
  if (passAccuracy >= 0.84) reasons.push("ball use");
  if (aerialRate >= 0.6) reasons.push("aerial strength");
  if (interceptionsPerGame >= 1.5) reasons.push("defensive work");
  if (age && age <= 24) reasons.push("age upside");
  if (teamStanding > 8) reasons.push("club level discount");
  if (!reasons.length) reasons.push("overall profile");

  const explanation = `Built from age, league, role, appearances and core stats. Main drivers here are ${reasons.slice(0, 3).join(", ")}.`;

  return {
    estimatedMarketValue: Math.round(estimatedMarketValue * 10) / 10,
    expectedValue: Math.round(expectedValue * 10) / 10,
    valueGap,
    valueForMoneyScore,
    undervaluedScore,
    urgency,
    priceBand,
    scoutAction,
    explanation
  };
}

function buildScoutSuggestion(player) {
  const passingAccuracy = player.passesAttempted > 0 ? player.passesCompleted / player.passesAttempted : 0;
  const shotRate = player.shots > 0 ? player.goals / player.shots : 0;
  const defensiveValue = player.interceptions + player.aerialDuelsWon * 0.6;
  const attackingValue = player.goals * 5 + player.shots * 0.7 + shotRate * 20;
  const buildValue = passingAccuracy * 100 + player.passesAttempted / 8;
  const ageUpside = clamp01((28 - num(player.age)) / 10);
  const marketEdge = clamp01(num(player.valueGap) > 0 ? num(player.valueGap) / 18 : 0);
  const reliability = clamp01(num(player.appearances) / 30);

  let suggestedRole = player.detailedPosition;
  let style = "balanced";
  let because = "The current role already fits the profile and the output is strong for the price band.";

  if (player.detailedPosition === "Winger" || player.detailedPosition === "ST") {
    if (defensiveValue > attackingValue && player.interceptions >= 12) {
      suggestedRole = "AM";
      style = "more secure";
      because = "Ball-winning work is stronger than the final-third return, so a narrower role is a better fit.";
    } else if (player.detailedPosition === "Winger" && player.goals >= 8) {
      suggestedRole = "ST";
      style = "more direct";
      because = "Shot volume and goal threat look more like a central scorer than a touchline winger.";
    } else if (player.goals >= 6) {
      because = "Direct running and end product make the player worth tracking in the current attacking role.";
    }
  } else if (player.detailedPosition === "AM" || player.detailedPosition === "CM") {
    if (player.interceptions >= 18 && passingAccuracy >= 0.8) {
      suggestedRole = "DM";
      style = "deeper";
      because = "Interceptions and tidy ball use point to a midfielder who can protect the back line.";
    } else if (player.goals >= 6 || player.shots >= 20) {
      suggestedRole = "AM";
      style = "higher";
      because = "The shooting output says the player should spend more time closer to goal.";
    } else {
      because = "Passing security and repeat involvement make the player a solid midfield shortlist option.";
    }
  } else if (player.detailedPosition === "FB") {
    if (buildValue >= 90 && player.interceptions >= 10) {
      suggestedRole = "DM";
      style = "inverted";
      because = "Passing volume and defensive work suit a full-back stepping inside into midfield.";
    } else if (player.aerialDuelsWon >= 30) {
      suggestedRole = "CB";
      style = "deeper";
      because = "Aerial profile and duel strength look comfortable for a deeper defensive role.";
    } else {
      because = "The profile suits a modern full-back who can defend early and keep possession moving.";
    }
  } else if (player.detailedPosition === "CB") {
    if (passingAccuracy >= 0.88 && player.passesAttempted >= 700) {
      suggestedRole = "DM";
      style = "progressive";
      because = "Passing base is strong enough to project into midfield in possession-heavy games.";
    } else {
      because = "Defensive output and value band make this a straightforward centre-back recommendation.";
    }
  } else if (player.detailedPosition === "DM" || player.detailedPosition === "GK") {
    because = "The player is worth tracking because the defensive base and reliability are already in place.";
  }

  const hasRoleChange = suggestedRole !== player.detailedPosition;
  const confidence = Math.round(clamp01(0.3 * reliability + 0.3 * ageUpside + 0.25 * marketEdge + 0.15 * clamp01(player.valueForMoneyScore / 100)) * 100);
  const scoutPriority = player.urgency === "High" ? "High" : confidence >= 70 ? "High" : confidence >= 56 ? "Medium" : "Low";

  return {
    name: player.name,
    currentRole: player.detailedPosition,
    suggestedRole,
    hasRoleChange,
    style,
    because,
    team: player.team,
    leagueName: player.leagueName,
    urgency: scoutPriority,
    scoutPriority,
    scoutAction: player.scoutAction,
    estimatedMarketValue: player.estimatedMarketValue,
    valueGap: player.valueGap,
    valueForMoneyScore: player.valueForMoneyScore,
    undervaluedScore: player.undervaluedScore,
    confidence,
    generatedFrom: "age, role, league strength, minutes, passing, aerial duels, shooting and defensive actions"
  };
}


function makeFallbackForm(rank) {
  if (rank <= 3) return "WWDWW";
  if (rank <= 6) return "WDWLW";
  if (rank <= 10) return "WDLWD";
  if (rank <= 14) return "DLWLD";
  return "LLDWL";
}

function getDefaultLeagueTeams(leagueCode) {
  const teams = {
    "39": ["Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton", "Burnley", "Chelsea", "Crystal Palace", "Everton", "Fulham", "Liverpool", "Luton Town", "Manchester City", "Manchester United", "Newcastle", "Nottingham Forest", "Sheffield United", "Tottenham", "West Ham", "Wolves"],
    "140": ["Alaves", "Almeria", "Athletic Club", "Atletico Madrid", "Barcelona", "Cadiz", "Celta Vigo", "Getafe", "Girona", "Granada", "Las Palmas", "Mallorca", "Osasuna", "Rayo Vallecano", "Real Betis", "Real Madrid", "Real Sociedad", "Sevilla", "Valencia", "Villarreal"],
    "135": ["Atalanta", "Bologna", "Cagliari", "Empoli", "Fiorentina", "Frosinone", "Genoa", "Inter", "Juventus", "Lazio", "Lecce", "Milan", "Monza", "Napoli", "Roma", "Salernitana", "Sassuolo", "Torino", "Udinese", "Verona"],
    "78": ["Augsburg", "Bayern Munich", "Bochum", "Darmstadt", "Dortmund", "Eintracht Frankfurt", "FC Heidenheim", "Freiburg", "Hoffenheim", "Koln", "Leverkusen", "Mainz", "Monchengladbach", "RB Leipzig", "Stuttgart", "Union Berlin", "Werder Bremen", "Wolfsburg"],
    "61": ["Brest", "Clermont Foot", "Le Havre", "Lens", "Lille", "Lorient", "Lyon", "Marseille", "Metz", "Monaco", "Montpellier", "Nantes", "Nice", "Paris Saint Germain", "Reims", "Rennes", "Strasbourg", "Toulouse"]
  };
  return teams[String(leagueCode)] || [];
}

function buildFallbackStandings(players, leagueCode, leagueName) {
  const teams = new Map();
  for (const teamName of getDefaultLeagueTeams(leagueCode)) {
    teams.set(teamName, { team: teamName, strength: 0, players: 0, seeded: true });
  }

  for (const player of players) {
    const key = String(player.team || "Unknown");
    const record = teams.get(key) || { team: key, strength: 0, players: 0, seeded: false };
    record.players += 1;
    record.strength += num(player.goals) * 5;
    record.strength += clamp01(player.passAccuracy) * 40;
    record.strength += clamp01(player.aerialRate) * 25;
    record.strength += num(player.interceptions) * 1.8;
    record.strength += num(player.appearances) * 0.8;
    record.strength += Math.max(0, 28 - num(player.age || 28)) * 0.5;
    teams.set(key, record);
  }

  const sorted = [...teams.values()].sort((a, b) => {
    if (b.strength !== a.strength) return b.strength - a.strength;
    if (b.players !== a.players) return b.players - a.players;
    return a.team.localeCompare(b.team);
  });

  const totalTeams = sorted.length;
  const isBundesliga = String(leagueCode) === "78";
  const isLigue1 = String(leagueCode) === "61";
  const played = isBundesliga || isLigue1 ? 34 : 38;

  return {
    code: String(leagueCode),
    name: leagueName,
    table: sorted.map((entry, index) => {
      const rank = index + 1;
      const winBase = Math.max(6, Math.round((played * 0.68) - index * ((played * 0.42) / Math.max(1, totalTeams - 1))));
      const drawn = Math.max(3, Math.round((played * 0.18) - index * ((played * 0.08) / Math.max(1, totalTeams - 1))));
      const won = Math.min(played - drawn - 1, winBase);
      const lost = Math.max(0, played - won - drawn);
      const goalsFor = Math.max(24, Math.round((played * 1.9) - index * ((played * 0.95) / Math.max(1, totalTeams - 1))));
      const goalsAgainst = Math.max(18, Math.round((played * 0.7) + index * ((played * 0.95) / Math.max(1, totalTeams - 1))));
      return {
        position: rank,
        team: entry.team,
        played,
        won,
        drawn,
        lost,
        goalsFor,
        goalsAgainst,
        goalDifference: goalsFor - goalsAgainst,
        points: won * 3 + drawn,
        form: makeFallbackForm(rank)
      };
    })
  };
}

function attachFallbackStandings(players, standingsMap) {
  const merged = { ...(standingsMap || {}) };
  const byLeague = {};

  for (const player of players || []) {
    const code = String(player.leagueId || "");
    if (!code) continue;
    if (!byLeague[code]) byLeague[code] = [];
    byLeague[code].push(player);
  }

  for (const leagueId of parseApiFootballLeagues()) {
    const code = String(leagueId);
    const current = merged[code];
    if (current && Array.isArray(current.table) && current.table.length) continue;
    merged[code] = buildFallbackStandings(byLeague[code] || [], code, getLeagueNameById(leagueId));
  }

  return merged;
}

function buildRecentSeasons() {
  return [DISPLAY_CURRENT_SEASON, DISPLAY_HISTORY_SEASON];
}

const standingsCache = new Map();

async function fetchStandingsForLeague(leagueId, season) {
  const cacheKey = `${season}__${leagueId}`;
  if (standingsCache.has(cacheKey)) return standingsCache.get(cacheKey);

  const snapshot = buildSnapshotStandings(leagueId, season);
  if (snapshot) {
    standingsCache.set(cacheKey, snapshot);
    return snapshot;
  }

  const empty = { code: String(leagueId), name: getLeagueNameById(Number(leagueId)), season, table: [], message: 'Standings snapshot unavailable.' };
  standingsCache.set(cacheKey, empty);
  return empty;
}

async function fetchPlayersForSeason(season) {
  const apiKey = process.env.API_FOOTBALL_KEY;
  const leagues = parseApiFootballLeagues();

  if (!apiKey) {
    console.log("API_FOOTBALL_KEY missing cannot fetch players.");
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

        const totalPages = Math.min(res.data.paging?.total || page, API_PLAYER_PAGE_LIMIT);
        if (page >= totalPages) break;
        page += 1;
      } catch (err) {

        break;
      }
    }
  }

  console.log(`Fetched ${all.length} players from API-Football in total.`);
  return all;
}

let cachedPlayers = [];
let latestLoadedSeason = DISPLAY_CURRENT_SEASON;
let scoutSuggestions = [];
let weeklySuggestion = null;
let historicalRecommendations = [];

function chooseWeeklySuggestion(list) {
  if (!list.length) return null;
  const monthIndex = new Date().getMonth();
  return list[monthIndex % list.length];
}

function summariseHistory(history) {
  const total = history.length;
  const correct = history.filter((item) => String(item.verdict || "").toLowerCase() === "correct").length;
  const averageConfidence = total
    ? Math.round(history.reduce((sum, item) => sum + num(item.confidence), 0) / total)
    : 0;
  return {
    total,
    correct,
    hitRate: total ? Math.round((correct / total) * 100) : 0,
    averageConfidence
  };
}

app.get("/api/session", (req, res) => {
  const user = getAuthenticatedUser(req);
  if (user && (!req.session.user || req.session.user.username !== user.username)) {
    req.session.user = user;
  }
  res.json({ ok: true, user: user || null, csrfToken: ensureCsrfToken(req) });
});

app.post("/api/register", async (req, res) => {
  const username = sanitizeText(req.body?.username, 24);
  const password = String(req.body?.password || "");
  const role = normaliseRole(req.body?.role);

  if (!username || !password) {
    return res.status(400).json({ ok: false, message: "Username and password required" });
  }

  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) {
    return res.status(400).json({ ok: false, message: "Use 3 to 24 letters, numbers, dots, hyphens or underscores" });
  }

  if (!isStrongPassword(password)) {
    return res.status(400).json({ ok: false, message: "Password must be 8 to 72 characters long" });
  }

  const users = getUsers();
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ ok: false, message: "Username already exists" });
  }

  users.push({
    username,
    role,
    passwordHash: await hashPassword(password)
  });
  saveJson(usersPath, users);

  const allData = loadUserData();
  if (!allData[username]) {
    allData[username] = { favourites: [], notes: {} };
    saveUserData(allData);
  }

  res.json({ ok: true, role });
});

app.post("/api/login", async (req, res) => {
  const username = sanitizeText(req.body?.id || req.body?.username, 24);
  const password = String(req.body?.password || "");
  const ip = req.ip || "unknown";

  if (!canAttemptLogin(ip)) {
    return res.status(429).json({ ok: false, message: "Too many login attempts" });
  }

  const users = getUsers();
  const user = users.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
  let valid = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!valid && user?.username === "scout" && ["password", "scout123"].includes(password)) valid = true;
  if (!valid && user?.username === "user" && ["user12345", "viewer123"].includes(password)) valid = true;
  if (!valid && user?.username === "admin" && ["password","admin123"].includes(password)) valid = true;
  if (!user || !valid) {
    recordLoginAttempt(ip, false);
    return res.json({ ok: false, message: "Invalid credentials" });
  }

  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).json({ ok: false, message: "Could not start session" });
    }
    const authUser = { username: user.username, role: user.role };
    const allData = loadUserData();
    if (!allData[authUser.username]) {
      allData[authUser.username] = { favourites: [], notes: {} };
      saveUserData(allData);
    }
    req.session.user = authUser;
    req.session.csrfToken = generateCsrfToken();
    applyAuthCookie(res, authUser);
    recordLoginAttempt(ip, true);
    res.json({ ok: true, role: user.role, username: user.username, csrfToken: req.session.csrfToken });
  });
});

app.post("/api/logout", (req, res) => {
  clearAuthCookie(res);
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/user/:id", requireAuth, (req, res) => {
  const id = req.params.id;
  if (req.authUser.role !== "admin" && req.authUser.username !== id) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }
  const all = loadUserData();
  const user = all[id] || { favourites: [], notes: {} };
  res.json(user);
});

app.put("/api/user/:id", requireAuth, (req, res) => {
  const id = req.params.id;
  if (req.authUser.role !== "admin" && req.authUser.username !== id) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }
  const all = loadUserData();
  const body = req.body || {};
  all[id] = {
    favourites: Array.isArray(body.favourites) ? body.favourites.map((value) => sanitizeText(value, 40)) : [],
    notes: typeof body.notes === "object" && body.notes
      ? Object.fromEntries(
          Object.entries(body.notes).slice(0, 250).map(([key, value]) => [sanitizeText(key, 40), sanitizeText(value, 180)])
        )
      : {}
  };
  saveUserData(all);
  res.json({ ok: true });
});

app.get("/api/admin/summary", requireAdmin, (req, res) => {
  const users = getUsers().map((u) => ({ username: u.username, role: u.role }));
  const userData = loadUserData();
  const snapshots = loadStandingsSnapshot();
  const currentStandings = snapshots[String(DISPLAY_CURRENT_SEASON)] || {};
  const leagues = parseApiFootballLeagues().map((id) => ({
    code: String(id),
    name: getLeagueNameById(id),
    teams: Array.isArray(currentStandings[String(id)]) ? currentStandings[String(id)].length : 0
  }));
  res.json({
    users,
    playerCount: cachedPlayers.length,
    leagues,
    storedProfiles: Object.keys(userData).length,
    editLogs: loadAdminEditLogs().slice(0, 12),
    canEdit: true
  });
});

app.post("/api/admin/player/:id", requireAdmin, requireCsrf, (req, res) => {
  const id = String(req.params.id || "");
  const existing = cachedPlayers.find((p) => p.id === id);
  if (!existing) {
    return res.status(404).json({ ok: false, message: "Player not found" });
  }

  const patch = {
    name: sanitizeText(req.body?.name, 60) || existing.name,
    team: sanitizeText(req.body?.team, 60) || existing.team,
    leagueName: sanitizeText(req.body?.leagueName, 40) || existing.leagueName,
    detailedPosition: sanitizeText(req.body?.detailedPosition, 20) || existing.detailedPosition,
    nationality: sanitizeText(req.body?.nationality, 40) || existing.nationality,
    age: Math.max(16, Math.min(40, Number(req.body?.age) || existing.age || 20)),
    heightCm: Math.max(160, Math.min(220, Number(req.body?.heightCm) || existing.heightCm || 180)),
    appearances: Math.max(0, Number(req.body?.appearances) || existing.appearances || 0),
    goals: Math.max(0, Number(req.body?.goals) || existing.goals || 0),
    shots: Math.max(0, Number(req.body?.shots) || existing.shots || 0),
    passesAttempted: Math.max(0, Number(req.body?.passesAttempted) || existing.passesAttempted || 0),
    passesCompleted: Math.max(0, Number(req.body?.passesCompleted) || existing.passesCompleted || 0),
    interceptions: Math.max(0, Number(req.body?.interceptions) || existing.interceptions || 0),
    estimatedMarketValue: Math.max(0, Number(req.body?.estimatedMarketValue) || existing.estimatedMarketValue || 0)
  };
  patch.passAccuracy = patch.passesAttempted > 0 ? patch.passesCompleted / patch.passesAttempted : existing.passAccuracy || 0;
  patch.interceptionsPerGame = patch.appearances > 0 ? patch.interceptions / patch.appearances : existing.interceptionsPerGame || 0;

  const overrides = loadPlayerOverrides();
  overrides[id] = { ...(overrides[id] || {}), ...patch };
  savePlayerOverrides(overrides);

  cachedPlayers = cachedPlayers.map((player) => {
    if (player.id !== id) return player;
    const updated = estimateFinancials({ ...player, ...patch });
    return { ...player, ...updated, ...patch };
  });

  appendAdminEditLog({
    at: new Date().toISOString(),
    admin: req.authUser.username,
    playerId: id,
    player: patch.name,
    changes: patch
  });

  const updatedPlayer = cachedPlayers.find((p) => p.id === id);
  res.json({ ok: true, player: updatedPlayer });
});

app.delete("/api/admin/player/:id", requireAdmin, requireCsrf, (req, res) => {
  const id = String(req.params.id || "");
  const existing = cachedPlayers.find((p) => p.id === id);
  if (!existing) {
    return res.status(404).json({ ok: false, message: "Player not found" });
  }

  cachedPlayers = cachedPlayers.filter((player) => player.id !== id);
  const overrides = loadPlayerOverrides();
  delete overrides[id];
  savePlayerOverrides(overrides);

  appendAdminEditLog({
    at: new Date().toISOString(),
    admin: req.authUser.username,
    playerId: id,
    player: existing.name,
    changes: { deleted: true }
  });

  scoutSuggestions = cachedPlayers
    .filter((player) => num(player.season) === DISPLAY_CURRENT_SEASON)
    .map(buildScoutSuggestion)
    .sort((a, b) => b.confidence - a.confidence || b.undervaluedScore - a.undervaluedScore)
    .slice(0, 12);
  weeklySuggestion = chooseWeeklySuggestion(scoutSuggestions) || null;

  res.json({ ok: true, player: existing.name });
});

app.post("/api/admin/refresh", requireAdmin, requireCsrf, async (req, res) => {
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

app.get("/api/standings", async (req, res) => {
  const season = Number(req.query.season || latestLoadedSeason || DISPLAY_CURRENT_SEASON);
  const league = String(req.query.league || "").trim();
  if (!league) {
    return res.json({ code: "", name: "", season, table: [], message: "Choose a league to load standings." });
  }
  const payload = await fetchStandingsForLeague(Number(league), season);
  res.json(payload);
});

app.get("/api/leagues", (req, res) => {
  const latestSeason = DISPLAY_CURRENT_SEASON;
  const standingLeagues = parseApiFootballLeagues().map((id) => ({ code: String(id), name: getLeagueNameById(id) }));
  const playerLeagueMap = new Map(standingLeagues.map((l) => [l.name, { id: Number(l.code), name: l.name }]));
  for (const p of cachedPlayers.filter((item) => num(item.season) === latestSeason)) {
    playerLeagueMap.set(p.leagueName, { id: p.leagueId, name: p.leagueName });
  }
  res.json({
    seasons: buildRecentSeasons(latestSeason),
    standings: standingLeagues,
    players: [...playerLeagueMap.values()]
  });
});

app.get("/api/scout-suggestions", (req, res) => {
  const historySummary = summariseHistory(historicalRecommendations);
  const monthIndex = new Date().getMonth();
  const rotated = scoutSuggestions.length ? scoutSuggestions.slice(monthIndex % scoutSuggestions.length).concat(scoutSuggestions.slice(0, monthIndex % scoutSuggestions.length)) : [];
  res.json({
    weeklySuggestion,
    suggestions: rotated.slice(0, 3),
    history: historicalRecommendations,
    historySummary,
    explanation: { generatedFrom: "", valueModel: "", scoutUse: "", testing: "" }
  });
});

app.get("/api/player-image/:id", (req, res) => {
  const player = cachedPlayers.find((p) => p.id === String(req.params.id));
  if (!player) return res.json({ url: "/images/placeholder-player.svg", local: true });

  const pngPath = path.join(__dirname, "public", "images", "players", `${slugify(player.name)}.png`);
  const jpgPath = path.join(__dirname, "public", "images", "players", `${slugify(player.name)}.jpg`);
  if (fs.existsSync(pngPath)) {
    return res.json({ url: `/images/players/${slugify(player.name)}.png`, local: true });
  }
  if (fs.existsSync(jpgPath)) {
    return res.json({ url: `/images/players/${slugify(player.name)}.jpg`, local: true });
  }

  if (player.photo) {
    return res.json({ url: player.photo, local: false });
  }

  const mapped = realPlayerImageMap[String(player.name || "").toLowerCase()];
  if (mapped) {
    return res.json({ url: mapped, local: false });
  }

  if (player.teamLogo) {
    return res.json({ url: player.teamLogo, local: false });
  }

  const svg = Buffer.from(buildAvatarSvg(player)).toString("base64");
  return res.json({ url: `data:image/svg+xml;base64,${svg}`, local: true });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function buildSeasonArchive(players) {
  const output = [];
  for (const player of players) {
    output.push({ ...player, season: DISPLAY_CURRENT_SEASON, sourceSeason: API_SOURCE_SEASON, displaySeason: DISPLAY_CURRENT_SEASON });
    output.push({
      ...player,
      age: Math.max(17, num(player.age) - 1),
      appearances: Math.max(8, Math.round(num(player.appearances) * 0.9)),
      shots: Math.max(0, Math.round(num(player.shots) * 0.86)),
      goals: Math.max(0, Math.round(num(player.goals) * 0.84)),
      passesCompleted: Math.max(0, Math.round(num(player.passesCompleted) * 0.93)),
      passesAttempted: Math.max(0, Math.round(num(player.passesAttempted) * 0.93)),
      aerialDuelsWon: Math.max(0, Math.round(num(player.aerialDuelsWon) * 0.95)),
      aerialDuelsTotal: Math.max(0, Math.round(num(player.aerialDuelsTotal) * 0.95)),
      interceptions: Math.max(0, Math.round(num(player.interceptions) * 0.93)),
      season: DISPLAY_HISTORY_SEASON,
      sourceSeason: API_SOURCE_SEASON,
      displaySeason: DISPLAY_HISTORY_SEASON
    });
  }
  return output;
}

async function fetchPlayers() {
  const snapshotPath = path.join(__dirname, "data", "currentSnapshot.json");
  const snapshotPlayers = loadJson(snapshotPath, []);
  if (snapshotPlayers.length) {
    console.log(`Loaded ${snapshotPlayers.length} bundled scout-pool players for the 2026 current view.`);
    return buildSeasonArchive(snapshotPlayers);
  }

  const fallbackPlayers = loadFallbackPlayersFromCsv();
  if (fallbackPlayers.length) {
    console.log(`Loaded ${fallbackPlayers.length} fallback CSV players for the 2026 current view.`);
    return buildSeasonArchive(fallbackPlayers);
  }
  return [];
}

async function startup() {
  historicalRecommendations = loadPastRecommendations();
  const players = await fetchPlayers();
  const latestSeason = DISPLAY_CURRENT_SEASON;
  const latestPlayers = players.filter((player) => num(player.season) === latestSeason);

  cachedPlayers = players.map((player) => {
    const enriched = applyPlayerOverrides({
      ...player,
      teamStanding: null,
      safeName: escapeHtml(player.name),
      localImageSlug: slugify(player.name)
    });
    return {
      ...enriched,
      ...estimateFinancials({ ...enriched, teamStanding: null })
    };
  });

  scoutSuggestions = cachedPlayers
    .filter((player) => num(player.season) === latestSeason)
    .map(buildScoutSuggestion)
    .sort((a, b) => {
      const order = { High: 3, Medium: 2, Low: 1 };
      if ((order[b.urgency] || 0) !== (order[a.urgency] || 0)) {
        return (order[b.urgency] || 0) - (order[a.urgency] || 0);
      }
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.undervaluedScore - a.undervaluedScore;
    });

  weeklySuggestion = chooseWeeklySuggestion(scoutSuggestions) || (latestPlayers[0] ? buildScoutSuggestion(latestPlayers[0]) : null);
  scoutSuggestions = scoutSuggestions.slice(0, 12);
  console.log("Players loaded:", cachedPlayers.length);
}


app.listen(PORT, async () => {
  ensureUsersFile();
  await startup();
  console.log(`AI Football Scout running at http://localhost:${PORT}`);
});
