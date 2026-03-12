const playerCardModal = document.getElementById("playerCardModal");
const closePlayerCardBtn = document.getElementById("closePlayerCard");
const playerCardImage = document.getElementById("playerCardImage");
const playerCardName = document.getElementById("playerCardName");
const playerCardTeam = document.getElementById("playerCardTeam");
const playerCardLeague = document.getElementById("playerCardLeague");
const playerCardPosition = document.getElementById("playerCardPosition");
const playerCardAge = document.getElementById("playerCardAge");
const playerCardHeight = document.getElementById("playerCardHeight");
const playerCardNationality = document.getElementById("playerCardNationality");
const playerCardApps = document.getElementById("playerCardApps");
const playerCardStanding = document.getElementById("playerCardStanding");
const cardHeadingPct = document.getElementById("cardHeadingPct");
const cardPassingPct = document.getElementById("cardPassingPct");
const cardConversionPct = document.getElementById("cardConversionPct");
const cardInterceptionsGame = document.getElementById("cardInterceptionsGame");
const cardGoals = document.getElementById("cardGoals");
const cardShots = document.getElementById("cardShots");

function pctCard(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`;
}

async function resolvePlayerImage(player) {
  if (player.photo) return player.photo;

  try {
    const res = await fetch(`/api/player-image/${encodeURIComponent(player.id)}`);
    const data = await res.json();
    if (data && data.url) return data.url;
  } catch (err) {
    console.error("Image lookup error:", err);
  }

  return "/images/placeholder-player.svg";
}

async function openPlayerCard(playerId) {
  const res = await fetch(`/api/player/${encodeURIComponent(playerId)}`);
  if (!res.ok) {
    alert("Player data could not be loaded.");
    return;
  }

  const player = await res.json();
  playerCardName.textContent = player.name || "Player";
  playerCardTeam.textContent = player.team || "N/A";
  playerCardLeague.textContent = player.leagueName || "N/A";
  playerCardPosition.textContent = player.detailedPosition || player.position || "N/A";
  playerCardAge.textContent = player.age || "N/A";
  playerCardHeight.textContent = player.heightCm ? `${player.heightCm} cm` : "N/A";
  playerCardNationality.textContent = player.nationality || "N/A";
  playerCardApps.textContent = player.appearances || 0;
  playerCardStanding.textContent = player.teamStanding || "N/A";
  cardHeadingPct.textContent = pctCard(player.headerWinRate);
  cardPassingPct.textContent = pctCard(player.passAccuracy);
  cardConversionPct.textContent = pctCard(player.shotConversion);
  cardInterceptionsGame.textContent = Number(player.interceptionsPerGame || 0).toFixed(2);
  cardGoals.textContent = player.goals || 0;
  cardShots.textContent = player.shots || 0;

  playerCardImage.src = "/images/placeholder-player.svg";
  playerCardImage.alt = `${player.name || "Player"} image`;
  playerCardImage.src = await resolvePlayerImage(player);
  playerCardImage.onerror = () => {
    playerCardImage.src = "/images/placeholder-player.svg";
  };

  playerCardModal.style.display = "flex";
}

closePlayerCardBtn.addEventListener("click", () => {
  playerCardModal.style.display = "none";
});

playerCardModal.addEventListener("click", (evt) => {
  if (evt.target === playerCardModal) {
    playerCardModal.style.display = "none";
  }
});

document.addEventListener("click", (evt) => {
  const btn = evt.target.closest(".player-link");
  if (!btn) return;
  openPlayerCard(btn.getAttribute("data-player-id"));
});
