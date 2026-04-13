const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = path.resolve(__dirname, "..");
const HTML_FILE = path.join(ROOT_DIR, "coffee-concepts.html");
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const USER_ID = "demo-user";

const BOT_TEMPLATES = [
  { id: "bot-alex", name: "Alex K.", initials: "AK", color: "#c9933a", bg: "rgba(201,147,58,0.2)", subject: "Math" },
  { id: "bot-priya", name: "Priya S.", initials: "PS", color: "#c86e8a", bg: "rgba(200,110,138,0.2)", subject: "Biology" },
  { id: "bot-omar", name: "Omar R.", initials: "OR", color: "#4e78b5", bg: "rgba(78,120,181,0.2)", subject: "CS" },
  { id: "bot-yuki", name: "Yuki T.", initials: "YT", color: "#5dab72", bg: "rgba(93,171,114,0.2)", subject: "Japanese" },
  { id: "bot-sam", name: "Sam L.", initials: "SL", color: "#9a8e82", bg: "rgba(154,142,130,0.2)", subject: "History" },
  { id: "bot-mei", name: "Mei C.", initials: "MC", color: "#a0bfee", bg: "rgba(160,191,238,0.2)", subject: "Design" },
  { id: "bot-emma", name: "Emma W.", initials: "EW", color: "#d89f66", bg: "rgba(216,159,102,0.2)", subject: "Economics" },
  { id: "bot-raj", name: "Raj P.", initials: "RP", color: "#d8c16f", bg: "rgba(216,193,111,0.2)", subject: "Physics" },
  { id: "bot-lina", name: "Lina V.", initials: "LV", color: "#9ed3c7", bg: "rgba(158,211,199,0.2)", subject: "Architecture" },
  { id: "bot-noah", name: "Noah D.", initials: "ND", color: "#8ba6d8", bg: "rgba(139,166,216,0.2)", subject: "Law" },
  { id: "bot-aya", name: "Aya N.", initials: "AN", color: "#e3a5b8", bg: "rgba(227,165,184,0.2)", subject: "Literature" },
  { id: "bot-jules", name: "Jules M.", initials: "JM", color: "#8ec3a7", bg: "rgba(142,195,167,0.2)", subject: "UX" },
  { id: "bot-hugo", name: "Hugo T.", initials: "HT", color: "#c1b0df", bg: "rgba(193,176,223,0.2)", subject: "Data Science" },
  { id: "bot-leah", name: "Leah B.", initials: "LB", color: "#e0b18d", bg: "rgba(224,177,141,0.2)", subject: "Psychology" },
  { id: "bot-zain", name: "Zain A.", initials: "ZA", color: "#92badf", bg: "rgba(146,186,223,0.2)", subject: "Chemistry" },
  { id: "bot-clara", name: "Clara F.", initials: "CF", color: "#dcb6df", bg: "rgba(220,182,223,0.2)", subject: "French" },
  { id: "bot-milo", name: "Milo G.", initials: "MG", color: "#d0c179", bg: "rgba(208,193,121,0.2)", subject: "Finance" },
  { id: "bot-nina", name: "Nina O.", initials: "NO", color: "#89cfbe", bg: "rgba(137,207,190,0.2)", subject: "Medicine" },
];

const LEADERBOARD_BOTS = [
  { id: "lb-emma", name: "Emma W.", minutes: 1470 },
  { id: "lb-raj", name: "Raj P.", minutes: 1330 },
  { id: "lb-yuki", name: "Yuki T.", minutes: 1190 },
  { id: "lb-alex", name: "Alex K.", minutes: 1040 },
  { id: "lb-sam", name: "Sam L.", minutes: 725 },
];

const presenceByRoom = new Map();
const socketAssignments = new Map();
let store = loadStore();

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.get("/", (_req, res) => res.sendFile(HTML_FILE));
app.get("/coffee-concepts.html", (_req, res) => res.sendFile(HTML_FILE));
app.get("/api/bootstrap", (_req, res) => res.json(buildBootstrapPayload()));
app.get("/api/dashboard", (_req, res) => res.json(buildDashboardPayload()));

app.post("/api/rooms", (req, res) => {
  const name = cleanText(req.body?.name, 40);
  const subject = cleanText(req.body?.subject, 40);
  const type = normalizeRoomType(req.body?.type);
  const theme = cleanText(req.body?.theme, 30) || "Dark Mode";
  const durationMinutes = clampNumber(req.body?.duration, 60, 240, 180);
  const cap = clampNumber(req.body?.cap, 20, 60, 40);

  if (!name || !subject) {
    res.status(400).json({ error: "Room name and study focus are required." });
    return;
  }

  const room = makeRoom({
    id: nextRoomId(),
    name,
    type,
    theme,
    subject,
    cap,
    durationMinutes,
    timeLeftMinutes: durationMinutes,
    baseMembers: 2,
  });

  store.rooms.unshift(room);
  saveStore();
  broadcastLobbyUpdate();
  res.status(201).json({ room: buildRoomSummary(room) });
});

app.post("/api/session-complete", (req, res) => {
  const minutes = clampNumber(req.body?.minutes, 5, 180, 25);
  const roomId = clampNumber(req.body?.roomId, 1, Number.MAX_SAFE_INTEGER, null);
  const todayKey = getDateKey();

  store.user.totalMinutes += minutes;
  store.user.leaderboardMinutes += minutes;
  store.user.sessionsCompleted += 1;
  store.user.history[todayKey] = (store.user.history[todayKey] || 0) + minutes;
  store.communityMinutesThisWeek += minutes;
  hydrateUserMetrics(store.user);

  if (roomId) {
    const room = findRoom(roomId);
    if (room) {
      pushRoomMessage(room, {
        id: buildId("system"),
        author: "Room Bot",
        text: `You completed a ${minutes} minute focus session. Nice work keeping the momentum going.`,
        system: true,
        createdAt: new Date().toISOString(),
      });
      emitRoomState(room.id);
    }
  }

  saveStore();
  broadcastLobbyUpdate();
  res.json({ dashboard: buildDashboardPayload(), leaderboard: buildLeaderboard() });
});

app.post("/api/preferences", (req, res) => {
  const { theme, pomodoroLength, sounds, focusMode } = req.body || {};
  if (typeof theme === "string" && theme.length <= 20) store.user.preferences.theme = theme;
  if (Number.isFinite(Number(pomodoroLength))) store.user.preferences.pomodoroLength = clampNumber(pomodoroLength, 25, 90, 25);
  if (sounds && typeof sounds === "object") store.user.preferences.sounds = { ...store.user.preferences.sounds, ...coerceBooleanMap(sounds) };
  if (focusMode && typeof focusMode === "object") store.user.preferences.focusMode = { ...store.user.preferences.focusMode, ...coerceBooleanMap(focusMode) };
  saveStore();
  res.json({ preferences: store.user.preferences });
});

app.get("/api/weather", async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || typeof fetch !== "function") {
    res.json(buildFallbackWeather());
    return;
  }

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("current", "temperature_2m,weather_code,is_day");
    url.searchParams.set("timezone", "auto");

    const response = await fetch(url, { headers: { "User-Agent": "CoffeeConcepts/1.0" } });
    if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);

    const payload = await response.json();
    const current = payload.current || {};
    res.json({
      icon: weatherCodeToIcon(current.weather_code, current.is_day),
      temp: Number.isFinite(current.temperature_2m) ? Math.round(current.temperature_2m) : 24,
      desc: weatherCodeToText(current.weather_code),
      city: "Near you",
    });
  } catch (_error) {
    res.json(buildFallbackWeather());
  }
});

io.on("connection", (socket) => {
  socket.on("room:join", (payload = {}, callback) => handleJoinRoom(socket, payload, callback));
  socket.on("room:leave", () => removeSocketFromPresence(socket));
  socket.on("member:update", (payload = {}) => handleMemberUpdate(socket, payload));
  socket.on("chat:send", (payload = {}) => handleChatSend(socket, payload));
  socket.on("buddy:request", (payload = {}) => handleBuddyRequest(socket, payload));
  socket.on("room:vote-extend", (payload = {}) => handleExtendVote(socket, payload));
  socket.on("room:extend-response", (payload = {}) => handleExtendResponse(socket, payload));
  socket.on("disconnect", () => removeSocketFromPresence(socket));
});

setInterval(() => {
  resetExpiredRooms();
  broadcastLobbyUpdate();
  for (const room of store.rooms) emitRoomState(room.id);
}, 30000);

server.listen(PORT, () => {
  console.log(`Coffee & Concepts server running on http://localhost:${PORT}`);
});

function handleJoinRoom(socket, payload, callback) {
  const roomId = clampNumber(payload.roomId, 1, Number.MAX_SAFE_INTEGER, null);
  const clientId = cleanText(payload.clientId, 64) || socket.id;
  const room = roomId ? findRoom(roomId) : null;

  if (!room) {
    if (typeof callback === "function") callback({ ok: false, error: "Room not found." });
    return;
  }

  removeSocketFromPresence(socket);
  const presence = upsertPresence(room.id, clientId, {
    clientId,
    userId: USER_ID,
    name: store.user.name,
    initials: store.user.initials,
    color: store.user.color,
    bg: store.user.bg,
    status: "Focusing",
    subject: room.subject,
    onBreak: false,
    micOn: true,
    camOn: true,
    joinedAt: new Date().toISOString(),
  });

  presence.socketIds.add(socket.id);
  socketAssignments.set(socket.id, { clientId, roomId: room.id });
  socket.join(roomChannel(room.id));

  emitRoomState(room.id);
  broadcastLobbyUpdate();
  scheduleBuddyPrompt(socket, room);

  if (typeof callback === "function") callback({ ok: true, room: buildRoomState(room) });
}

function handleMemberUpdate(socket, payload) {
  const roomId = clampNumber(payload.roomId, 1, Number.MAX_SAFE_INTEGER, null);
  const clientId = cleanText(payload.clientId, 64) || socketAssignments.get(socket.id)?.clientId;
  if (!roomId || !clientId) return;

  const roomPresence = presenceByRoom.get(roomId);
  const existing = roomPresence?.get(clientId);
  if (!existing) return;

  if (typeof payload.status === "string") existing.status = cleanText(payload.status, 20) || existing.status;
  if (typeof payload.subject === "string") existing.subject = cleanText(payload.subject, 40) || existing.subject;
  if (typeof payload.onBreak === "boolean") {
    existing.onBreak = payload.onBreak;
    existing.status = payload.onBreak ? "On Break" : "Focusing";
  }
  if (typeof payload.micOn === "boolean") existing.micOn = payload.micOn;
  if (typeof payload.camOn === "boolean") existing.camOn = payload.camOn;

  emitRoomState(roomId);
}

function handleChatSend(socket, payload) {
  const roomId = clampNumber(payload.roomId, 1, Number.MAX_SAFE_INTEGER, null);
  const clientId = cleanText(payload.clientId, 64) || socketAssignments.get(socket.id)?.clientId;
  const text = cleanText(payload.text, 280);
  const room = roomId ? findRoom(roomId) : null;
  if (!room || !clientId || !text) return;

  const roomPresence = presenceByRoom.get(room.id);
  const member = roomPresence?.get(clientId);
  pushRoomMessage(room, {
    id: buildId("msg"),
    author: member?.name || store.user.name,
    text,
    clientId,
    createdAt: new Date().toISOString(),
  });
  saveStore();
  emitRoomState(room.id);
  scheduleBotReply(room, text);
}

function handleBuddyRequest(socket, payload) {
  const roomId = clampNumber(payload.roomId, 1, Number.MAX_SAFE_INTEGER, null);
  const room = roomId ? findRoom(roomId) : null;
  if (!room) return;

  const name = cleanText(payload.name, 60);
  const bot = room.previewBots.find((member) => member.name === name) || room.previewBots[0];
  if (!bot) return;

  setTimeout(() => {
    socket.emit("buddy:accepted", {
      name: bot.name,
      subject: bot.subject,
      message: `${bot.name} is happy to keep you company while you study ${bot.subject}.`,
    });
  }, 900);
}

function handleExtendVote(socket, payload) {
  const roomId = clampNumber(payload.roomId, 1, Number.MAX_SAFE_INTEGER, null);
  const room = roomId ? findRoom(roomId) : null;
  if (!room) return;

  const supporters = Math.min(room.baseMembers + getActiveHumans(room.id).length, 3) || 1;
  socket.emit("room:extend-offer", { roomId: room.id, supporters, extraMinutes: 30 });
}

function handleExtendResponse(socket, payload) {
  const roomId = clampNumber(payload.roomId, 1, Number.MAX_SAFE_INTEGER, null);
  const room = roomId ? findRoom(roomId) : null;
  if (!room) return;

  if (payload.accept) {
    room.endsAt = new Date(new Date(room.endsAt).getTime() + 30 * 60 * 1000).toISOString();
    pushRoomMessage(room, {
      id: buildId("system"),
      author: "Room Bot",
      text: "The room was extended by 30 minutes. Settle back in and keep going.",
      system: true,
      createdAt: new Date().toISOString(),
    });
    saveStore();
    emitRoomState(room.id);
    broadcastLobbyUpdate();
    socket.emit("room:extend-result", { accepted: true, roomId: room.id, extraMinutes: 30 });
    return;
  }

  socket.emit("room:extend-result", { accepted: false, roomId: room.id, extraMinutes: 30 });
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(STORE_FILE)) {
    const seeded = seedStore();
    fs.writeFileSync(STORE_FILE, JSON.stringify(seeded, null, 2));
    return seeded;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    parsed.rooms = Array.isArray(parsed.rooms) ? parsed.rooms.map(normalizeRoom) : seedStore().rooms;
    parsed.user = normalizeUser(parsed.user);
    parsed.communityMinutesThisWeek = Number.isFinite(parsed.communityMinutesThisWeek) ? parsed.communityMinutesThisWeek : 252000;
    hydrateUserMetrics(parsed.user);
    return parsed;
  } catch (_error) {
    const fallback = seedStore();
    fs.writeFileSync(STORE_FILE, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

function saveStore() {
  ensureDataDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function seedStore() {
  const history = buildHistoryFromHours([2.5, 4, 3, 5.5, 6, 1.5, 0.5]);
  const user = normalizeUser({
    id: USER_ID,
    name: "You",
    initials: "ME",
    color: "#c9933a",
    bg: "rgba(201,147,58,0.2)",
    totalMinutes: 2880,
    leaderboardMinutes: 880,
    sessionsCompleted: 12,
    history,
    preferences: {
      theme: "default",
      pomodoroLength: 25,
      sounds: { lofi: true, rain: false, cafe: false },
      focusMode: { cameraRequired: true, breakReminders: true, sessionSummary: true },
    },
  });

  hydrateUserMetrics(user);
  return {
    user,
    communityMinutesThisWeek: 252000,
    rooms: [
      makeRoom({ id: 1, name: "Quiet Library", type: "neutral", theme: "Dark Mode", subject: "General Study", cap: 40, durationMinutes: 180, timeLeftMinutes: 165, baseMembers: 23 }),
      makeRoom({ id: 2, name: "Lavender Lounge", type: "female", theme: "Cafe Ambient", subject: "Exam Prep", cap: 40, durationMinutes: 120, timeLeftMinutes: 95, baseMembers: 14 }),
      makeRoom({ id: 3, name: "Deep Work Den", type: "male", theme: "Minimalist", subject: "Coding", cap: 40, durationMinutes: 60, timeLeftMinutes: 42, baseMembers: 8 }),
      makeRoom({ id: 4, name: "Dawn Desk", type: "neutral", theme: "Night Owl", subject: "Productivity", cap: 50, durationMinutes: 120, timeLeftMinutes: 110, baseMembers: 31 }),
      makeRoom({ id: 5, name: "Bloom Room", type: "female", theme: "Cafe Ambient", subject: "Language Learning", cap: 40, durationMinutes: 90, timeLeftMinutes: 78, baseMembers: 19 }),
      makeRoom({ id: 6, name: "The Grind", type: "neutral", theme: "Dark Mode", subject: "Deep Work", cap: 40, durationMinutes: 180, timeLeftMinutes: 140, baseMembers: 38 }),
    ],
  };
}

function normalizeUser(input) {
  const user = {
    id: input?.id || USER_ID,
    name: cleanText(input?.name, 40) || "You",
    initials: cleanText(input?.initials, 4) || "ME",
    color: input?.color || "#c9933a",
    bg: input?.bg || "rgba(201,147,58,0.2)",
    totalMinutes: clampNumber(input?.totalMinutes, 0, 999999, 0),
    leaderboardMinutes: clampNumber(input?.leaderboardMinutes, 0, 999999, 0),
    sessionsCompleted: clampNumber(input?.sessionsCompleted, 0, 999999, 0),
    streakDays: clampNumber(input?.streakDays, 0, 3650, 0),
    focusScore: clampNumber(input?.focusScore, 0, 99, 0),
    history: input?.history && typeof input.history === "object" ? input.history : {},
    preferences: {
      theme: input?.preferences?.theme || "default",
      pomodoroLength: clampNumber(input?.preferences?.pomodoroLength, 25, 90, 25),
      sounds: {
        lofi: Boolean(input?.preferences?.sounds?.lofi),
        rain: Boolean(input?.preferences?.sounds?.rain),
        cafe: Boolean(input?.preferences?.sounds?.cafe),
      },
      focusMode: {
        cameraRequired: input?.preferences?.focusMode?.cameraRequired !== false,
        breakReminders: input?.preferences?.focusMode?.breakReminders !== false,
        sessionSummary: input?.preferences?.focusMode?.sessionSummary !== false,
      },
    },
  };

  pruneHistory(user.history);
  return user;
}

function normalizeRoom(room) {
  const normalized = {
    id: clampNumber(room?.id, 1, Number.MAX_SAFE_INTEGER, 1),
    name: cleanText(room?.name, 40) || "Untitled Room",
    type: normalizeRoomType(room?.type),
    theme: cleanText(room?.theme, 30) || "Dark Mode",
    subject: cleanText(room?.subject, 40) || "General Study",
    subjectIcon: room?.subjectIcon || pickSubjectIcon(room?.subject),
    cap: clampNumber(room?.cap, 20, 60, 40),
    durationMinutes: clampNumber(room?.durationMinutes, 45, 240, 180),
    endsAt: room?.endsAt || futureIso(clampNumber(room?.durationMinutes, 45, 240, 180)),
    createdAt: room?.createdAt || new Date().toISOString(),
    baseMembers: clampNumber(room?.baseMembers, 0, 200, 6),
    previewBots: Array.isArray(room?.previewBots) && room.previewBots.length ? room.previewBots : buildPreviewBots(clampNumber(room?.id, 1, 9999, 1), room?.subject, 6),
    messages: Array.isArray(room?.messages) ? room.messages.slice(-50) : [],
  };

  if (!normalized.messages.length) normalized.messages = buildInitialMessages(normalized.previewBots);
  return normalized;
}

function makeRoom(config) {
  const previewBots = buildPreviewBots(config.id, config.subject, 6);
  return normalizeRoom({
    id: config.id,
    name: config.name,
    type: config.type,
    theme: config.theme,
    subject: config.subject,
    subjectIcon: pickSubjectIcon(config.subject),
    cap: config.cap,
    durationMinutes: config.durationMinutes,
    endsAt: futureIso(config.timeLeftMinutes || config.durationMinutes),
    createdAt: new Date().toISOString(),
    baseMembers: config.baseMembers,
    previewBots,
    messages: buildInitialMessages(previewBots),
  });
}

function buildInitialMessages(previewBots) {
  const [first, second] = previewBots;
  return [
    { id: buildId("msg"), author: first?.name || "Room Bot", text: "Good luck everyone. Let's lock in for this session.", createdAt: new Date().toISOString() },
    { id: buildId("msg"), author: second?.name || "Room Bot", text: "Deep breaths, one task at a time. We have this.", createdAt: new Date().toISOString() },
  ];
}

function buildPreviewBots(seed, roomSubject, count) {
  const bots = [];
  for (let index = 0; index < count; index += 1) {
    const template = BOT_TEMPLATES[(seed + index) % BOT_TEMPLATES.length];
    const onBreak = index === 1 && seed % 2 === 0;
    bots.push({
      id: `${template.id}-${seed}-${index}`,
      name: template.name,
      initials: template.initials,
      color: template.color,
      bg: template.bg,
      subject: index % 2 === 0 ? roomSubject : template.subject,
      status: onBreak ? "On Break" : "Focusing",
      onBreak,
      micOn: true,
      camOn: true,
      isBot: true,
    });
  }
  return bots;
}

function buildBootstrapPayload() {
  resetExpiredRooms();
  return {
    user: { id: store.user.id, name: store.user.name, initials: store.user.initials, preferences: store.user.preferences },
    community: buildCommunityStats(),
    rooms: store.rooms.map(buildRoomSummary),
    leaderboard: buildLeaderboard(),
    dashboard: buildDashboardPayload(),
  };
}

function buildCommunityStats() {
  const humanCount = [...presenceByRoom.values()].reduce((total, roomPresence) => total + roomPresence.size, 0);
  const baseCount = store.rooms.reduce((total, room) => total + room.baseMembers, 0);
  return {
    liveCount: baseCount + humanCount,
    activeRooms: store.rooms.length,
    hoursThisWeek: Math.round(store.communityMinutesThisWeek / 60),
  };
}

function buildRoomSummary(room) {
  return {
    id: room.id,
    name: room.name,
    type: room.type,
    theme: room.theme,
    subjectIcon: room.subjectIcon,
    subject: room.subject,
    members: room.baseMembers + getActiveHumans(room.id).length,
    cap: room.cap,
    timeLeft: minutesLeft(room.endsAt),
    timeTotal: room.durationMinutes,
    previewMembers: room.previewBots.slice(0, 4),
  };
}

function buildRoomState(room) {
  const humans = getActiveHumans(room.id).map((member) => stripSocketData(member));
  const visibleMembers = [...humans, ...room.previewBots.slice(0, 6)];
  const totalCount = room.baseMembers + humans.length;
  return {
    id: room.id,
    name: room.name,
    type: room.type,
    theme: room.theme,
    subject: room.subject,
    subjectIcon: room.subjectIcon,
    cap: room.cap,
    timeLeft: minutesLeft(room.endsAt),
    timeTotal: room.durationMinutes,
    membersCount: totalCount,
    overflowCount: Math.max(0, totalCount - visibleMembers.length),
    visibleMembers,
    messages: room.messages.slice(-50),
  };
}

function buildLeaderboard() {
  return [
    ...LEADERBOARD_BOTS.map((bot) => ({ id: bot.id, name: bot.name, minutes: bot.minutes, isYou: false })),
    { id: store.user.id, name: store.user.name, minutes: store.user.leaderboardMinutes, isYou: true },
  ]
    .sort((left, right) => right.minutes - left.minutes)
    .slice(0, 6)
    .map((entry, index) => ({ rank: index + 1, name: entry.name, time: formatMinutes(entry.minutes), isYou: entry.isYou }));
}

function buildDashboardPayload() {
  return {
    streakDays: store.user.streakDays,
    totalMinutes: store.user.totalMinutes,
    todayMinutes: store.user.history[getDateKey()] || 0,
    sessionsCompleted: store.user.sessionsCompleted,
    focusScore: store.user.focusScore,
    weekHours: getWeekHours(store.user.history),
  };
}

function hydrateUserMetrics(user) {
  pruneHistory(user.history);
  user.streakDays = calculateStreak(user.history);
  const activeDays = getWeekHours(user.history).filter((value) => value > 0).length;
  const sessionBonus = Math.min(14, Math.round(user.sessionsCompleted / 2));
  const streakBonus = Math.min(12, user.streakDays * 2);
  const consistencyBonus = activeDays * 4;
  user.focusScore = Math.min(99, 62 + sessionBonus + streakBonus + consistencyBonus);
}

function pruneHistory(history) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 45);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  Object.keys(history || {}).forEach((key) => {
    if (key < cutoffKey) delete history[key];
  });
}

function calculateStreak(history) {
  let streak = 0;
  const cursor = new Date();
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if ((history[key] || 0) <= 0) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function getWeekHours(history) {
  const hours = [];
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - 6);
  for (let index = 0; index < 7; index += 1) {
    const key = cursor.toISOString().slice(0, 10);
    hours.push(Number(((history[key] || 0) / 60).toFixed(1)));
    cursor.setDate(cursor.getDate() + 1);
  }
  return hours;
}

function buildHistoryFromHours(hours) {
  const history = {};
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - (hours.length - 1));
  hours.forEach((value) => {
    history[cursor.toISOString().slice(0, 10)] = Math.round(value * 60);
    cursor.setDate(cursor.getDate() + 1);
  });
  return history;
}

function upsertPresence(roomId, clientId, payload) {
  if (!presenceByRoom.has(roomId)) presenceByRoom.set(roomId, new Map());
  const roomPresence = presenceByRoom.get(roomId);
  const existing = roomPresence.get(clientId) || { socketIds: new Set() };
  Object.assign(existing, payload);
  roomPresence.set(clientId, existing);
  return existing;
}

function getActiveHumans(roomId) {
  return [...(presenceByRoom.get(roomId)?.values() || [])];
}

function stripSocketData(member) {
  const { socketIds, ...safeMember } = member;
  return safeMember;
}

function removeSocketFromPresence(socket) {
  const assignment = socketAssignments.get(socket.id);
  if (!assignment) return;

  const roomPresence = presenceByRoom.get(assignment.roomId);
  const member = roomPresence?.get(assignment.clientId);
  if (member) {
    member.socketIds.delete(socket.id);
    if (!member.socketIds.size) roomPresence.delete(assignment.clientId);
  }
  if (roomPresence && roomPresence.size === 0) presenceByRoom.delete(assignment.roomId);

  socket.leave(roomChannel(assignment.roomId));
  socketAssignments.delete(socket.id);
  emitRoomState(assignment.roomId);
  broadcastLobbyUpdate();
}

function emitRoomState(roomId) {
  const room = findRoom(roomId);
  if (room) io.to(roomChannel(roomId)).emit("room:state", buildRoomState(room));
}

function broadcastLobbyUpdate() {
  io.emit("lobby:update", buildBootstrapPayload());
}

function roomChannel(roomId) {
  return `room:${roomId}`;
}

function scheduleBotReply(room, messageText) {
  const lowercase = messageText.toLowerCase();
  const templates = [
    "Same here, heads down and making progress.",
    "Nice pace. This room has great focus energy right now.",
    "Small steps still count. Keep going.",
    "That sounds productive. I am wrapping up one more chapter.",
    lowercase.includes("break") ? "A quick reset sounds good. See you back in focus mode." : "Love the accountability in here.",
  ];

  setTimeout(() => {
    const currentRoom = findRoom(room.id);
    if (!currentRoom) return;
    const speaker = currentRoom.previewBots[(Date.now() + room.id) % currentRoom.previewBots.length];
    pushRoomMessage(currentRoom, {
      id: buildId("msg"),
      author: speaker.name,
      text: templates[(Date.now() + currentRoom.id) % templates.length],
      createdAt: new Date().toISOString(),
    });
    saveStore();
    emitRoomState(currentRoom.id);
  }, 1200);
}

function scheduleBuddyPrompt(socket, room) {
  setTimeout(() => {
    const assignment = socketAssignments.get(socket.id);
    if (!assignment || assignment.roomId !== room.id) return;
    const bot = room.previewBots[(room.id + Date.now()) % room.previewBots.length];
    socket.emit("buddy:prompt", { name: bot.name, subject: bot.subject });
  }, 6000);
}

function pushRoomMessage(room, message) {
  room.messages.push(message);
  room.messages = room.messages.slice(-50);
}

function resetExpiredRooms() {
  let changed = false;
  for (const room of store.rooms) {
    if (new Date(room.endsAt).getTime() <= Date.now()) {
      room.endsAt = futureIso(room.durationMinutes);
      room.messages = room.messages.slice(-25);
      pushRoomMessage(room, {
        id: buildId("system"),
        author: "Room Bot",
        text: "A fresh room session just started. Set your goal and dive in.",
        system: true,
        createdAt: new Date().toISOString(),
      });
      changed = true;
    }
  }
  if (changed) saveStore();
}

function buildFallbackWeather() {
  return { icon: "☕", temp: 24, desc: "Weather check unavailable right now", city: "Study mode" };
}

function weatherCodeToText(code) {
  const map = { 0: "Clear skies", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Foggy", 48: "Foggy", 51: "Light drizzle", 53: "Drizzle", 55: "Steady drizzle", 61: "Light rain", 63: "Rain showers", 65: "Heavy rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow", 80: "Rain showers", 81: "Rain showers", 82: "Strong showers", 95: "Thunderstorm" };
  return map[code] || "Calm weather";
}

function weatherCodeToIcon(code, isDay) {
  if (code === 0) return isDay ? "☀️" : "🌙";
  if ([1, 2].includes(code)) return isDay ? "🌤" : "☁️";
  if ([3, 45, 48].includes(code)) return "☁️";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "🌧";
  if ([71, 73, 75].includes(code)) return "❄️";
  if (code === 95) return "⛈";
  return "🌥";
}

function nextRoomId() {
  return (store?.rooms || []).reduce((max, room) => Math.max(max, Number(room.id) || 0), 0) + 1;
}

function findRoom(id) {
  return store.rooms.find((room) => room.id === id) || null;
}

function minutesLeft(isoString) {
  return Math.max(0, Math.ceil((new Date(isoString).getTime() - Date.now()) / 60000));
}

function futureIso(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function formatMinutes(minutes) {
  const totalMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(totalMinutes / 60);
  const remainder = totalMinutes % 60;
  if (hours <= 0) return `${remainder}m`;
  return `${hours}h ${String(remainder).padStart(2, "0")}m`;
}

function normalizeRoomType(type) {
  return ["neutral", "female", "male"].includes(type) ? type : "neutral";
}

function pickSubjectIcon(subject) {
  const value = String(subject || "").toLowerCase();
  if (value.includes("code") || value.includes("coding") || value.includes("cs") || value.includes("software")) return "💻";
  if (value.includes("language") || value.includes("japanese") || value.includes("french")) return "🌸";
  if (value.includes("design") || value.includes("art")) return "🎨";
  if (value.includes("exam")) return "📝";
  if (value.includes("product") || value.includes("focus") || value.includes("deep")) return "⚡";
  if (value.includes("math")) return "📐";
  return "📚";
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function coerceBooleanMap(input) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, Boolean(value)]));
}

function buildId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getDateKey() {
  return new Date().toISOString().slice(0, 10);
}
