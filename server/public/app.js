const socket = io();

const state = {
  clientId: getOrCreateClientId(),
  bootstrap: null,
  currentRoomId: null,
  room: null,
  dashboard: null,
  activeTab: "timer",
  timerSeconds: 25 * 60,
  timerTotal: 25 * 60,
  timerRunning: false,
  timerInterval: null,
  sessionCount: 1,
  totalSessions: 4,
  breakSeconds: 5 * 60,
  breakInterval: null,
  onBreak: false,
  micOn: true,
  camOn: true,
  localStream: null,
  mediaPending: false,
  pendingBuddy: null,
  pendingExtend: null,
  preferences: {
    theme: "default",
    pomodoroLength: 25,
    sounds: { lofi: true, rain: false, cafe: false },
    focusMode: { cameraRequired: true, breakReminders: true, sessionSummary: true },
  },
  audio: {
    context: null,
    sources: {},
  },
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindStaticEvents();
  registerSocketEvents();
  await refreshBootstrap();
  applyPreferences(state.bootstrap?.user?.preferences || {}, { hydrateTimer: true });
  updateTimerDisplay();
  showScreen("landing");
}

function bindStaticEvents() {
  const createRoomForm = document.getElementById("create-room-form");
  if (createRoomForm) {
    createRoomForm.addEventListener("submit", handleCreateRoomSubmit);
  }
}

function registerSocketEvents() {
  socket.on("connect", () => {
    if (state.currentRoomId) {
      socket.emit("room:join", { roomId: state.currentRoomId, clientId: state.clientId }, handleRoomJoinResponse);
    }
  });

  socket.on("lobby:update", (payload) => {
    state.bootstrap = payload;
    if (payload?.user?.preferences) applyPreferences(payload.user.preferences);
    renderLandingStats();
    renderRooms();
    renderLeaderboard();
    if (document.getElementById("dashboard-modal").classList.contains("show")) renderDashboard();
  });

  socket.on("room:state", (room) => {
    if (!room || room.id !== state.currentRoomId) return;
    state.room = room;
    renderRoom();
  });

  socket.on("buddy:prompt", (payload) => {
    state.pendingBuddy = payload;
    document.getElementById("notif-title").textContent = `${payload.name} wants to connect`;
    document.getElementById("notif-body").textContent = `They're studying ${payload.subject}. Accept to open a private chat?`;
    document.getElementById("buddy-notif").classList.add("show");
  });

  socket.on("buddy:accepted", (payload) => {
    state.pendingBuddy = payload;
    document.getElementById("notif-title").textContent = `${payload.name} accepted`;
    document.getElementById("notif-body").textContent = payload.message;
    document.getElementById("buddy-notif").classList.add("show");
    switchTab("chat", document.querySelectorAll(".side-tab")[2]);
  });

  socket.on("room:extend-offer", (payload) => {
    state.pendingExtend = payload;
    document.querySelector("#extend-notif .notif-body").textContent = `${payload.supporters} people voted to extend the session by ${payload.extraMinutes} minutes.`;
    document.getElementById("extend-notif").classList.add("show");
  });

  socket.on("room:extend-result", (payload) => {
    const body = document.querySelector("#extend-notif .notif-body");
    body.textContent = payload.accepted ? `The room was extended by ${payload.extraMinutes} minutes.` : "No worries. The room will stay on its current schedule.";
    if (payload.accepted) {
      setTimeout(() => closeNotif("extend-notif"), 1800);
    } else {
      closeNotif("extend-notif");
    }
    state.pendingExtend = null;
  });
}

async function refreshBootstrap() {
  const response = await fetch("/api/bootstrap");
  const payload = await response.json();
  state.bootstrap = payload;
  state.dashboard = payload.dashboard;
  renderLandingStats();
  renderRooms();
  renderLeaderboard();
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.remove("active"));
  document.getElementById(`screen-${id}`).classList.add("active");
}

function showLobby() {
  renderLandingStats();
  renderRooms();
  renderLeaderboard();
  showScreen("lobby");
}

async function showDashboard() {
  try {
    const response = await fetch("/api/dashboard");
    state.dashboard = await response.json();
  } catch (_error) {
    state.dashboard = state.bootstrap?.dashboard || state.dashboard;
  }
  renderDashboard();
  document.getElementById("dashboard-modal").classList.add("show");
}

function closeDashboard() {
  document.getElementById("dashboard-modal").classList.remove("show");
}

function renderLandingStats() {
  const community = state.bootstrap?.community;
  if (!community) return;
  document.getElementById("live-count").textContent = community.liveCount;
  document.getElementById("active-room-count").textContent = community.activeRooms;
  document.getElementById("weekly-hours-total").textContent = formatCompactHours(community.hoursThisWeek);
}

function renderRooms() {
  const grid = document.getElementById("room-grid");
  const rooms = state.bootstrap?.rooms || [];
  grid.innerHTML = rooms.map((room) => {
    const pct = Math.max(0, Math.min(100, Math.round((room.timeLeft / room.timeTotal) * 100)));
    const badgeClass = room.type === "neutral" ? "badge-neutral" : room.type === "female" ? "badge-female" : "badge-male";
    const badgeText = room.type === "neutral" ? "All" : room.type === "female" ? "Women" : "Men";
    const avatars = (room.previewMembers || []).map((member) => `<div class="avatar-mini" style="background:${member.bg};color:${member.color};">${escapeHtml(member.initials)}</div>`).join("");
    return `<div class="room-card ${room.type}" onclick="joinRoom(${room.id})">
      <div class="room-card-header">
        <div><div class="room-name">${escapeHtml(room.subjectIcon)} ${escapeHtml(room.name)}</div><div class="room-theme">${escapeHtml(room.theme)} · ${escapeHtml(room.subject)}</div></div>
        <span class="room-badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="room-meta">
        <div class="room-meta-item">${avatars}<span style="margin-left:6px;">${room.members}/${room.cap}</span></div>
        <div style="flex:1;"></div>
        <span style="font-size:0.75rem;color:var(--muted2);">${pct > 50 ? "🟢" : pct > 20 ? "🟡" : "🔴"} Active</span>
      </div>
      <div class="room-timer-bar">
        <div class="timer-bar-track"><div class="timer-bar-fill" style="width:${pct}%"></div></div>
        <div class="room-timer-label">${formatShortDuration(room.timeLeft)} remaining</div>
      </div>
    </div>`;
  }).join("");
}

function renderLeaderboard() {
  const list = document.getElementById("lb-list");
  const leaderboard = state.bootstrap?.leaderboard || [];
  list.innerHTML = leaderboard.map((row) => {
    const rankClass = row.rank === 1 ? "gold" : row.rank === 2 ? "silver" : row.rank === 3 ? "bronze" : "";
    const rankIcon = row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : row.rank;
    return `<div class="lb-row">
      <div class="lb-rank ${rankClass}">${rankIcon}</div>
      <div class="lb-name" style="${row.isYou ? "color:var(--gold2);font-weight:500;" : ""}">${escapeHtml(row.name)}${row.isYou ? " (you)" : ""}</div>
      <div class="lb-time">${escapeHtml(row.time)}</div>
    </div>`;
  }).join("");
}

function renderDashboard() {
  const dashboard = state.dashboard || state.bootstrap?.dashboard;
  if (!dashboard) return;
  document.getElementById("dash-streak").textContent = dashboard.streakDays;
  document.getElementById("dash-total").textContent = formatMinutesLong(dashboard.totalMinutes);
  document.getElementById("dash-today").textContent = formatMinutesLong(dashboard.todayMinutes);
  document.getElementById("dash-sessions").textContent = dashboard.sessionsCompleted;
  document.getElementById("dash-focus-score").textContent = dashboard.focusScore;
  renderWeekBars(dashboard.weekHours || []);
}

function renderWeekBars(weekHours) {
  const max = Math.max(...weekHours, 1);
  document.getElementById("week-bars").innerHTML = weekHours.map((hours, index) => {
    const pct = Math.max(6, (hours / max) * 100);
    const isToday = index === weekHours.length - 1;
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
      <div style="width:100%;height:${pct}%;background:${isToday ? "var(--gold)" : "var(--card2)"};border:1px solid ${isToday ? "var(--gold)" : "var(--border)"};border-radius:3px;min-height:4px;transition:height 0.5s ease;" title="${hours}h"></div>
    </div>`;
  }).join("");
}

async function handleCreateRoomSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const getValue = (field) => form.elements.namedItem(field).value;
  const body = {
    name: getValue("name"),
    subject: getValue("subject"),
    type: getValue("type"),
    theme: getValue("theme"),
    duration: Number(getValue("duration")),
    cap: Number(getValue("cap")),
  };

  const response = await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    alert(payload.error || "Could not create the room.");
    return;
  }

  const payload = await response.json();
  closeCreateRoom();
  form.reset();
  await refreshBootstrap();
  joinRoom(payload.room.id);
}

function openCreateRoom() {
  document.getElementById("create-room-modal").classList.add("show");
}

function closeCreateRoom() {
  document.getElementById("create-room-modal").classList.remove("show");
}

function joinRoom(id) {
  state.currentRoomId = Number(id);
  socket.emit("room:join", { roomId: state.currentRoomId, clientId: state.clientId }, handleRoomJoinResponse);
}

function handleRoomJoinResponse(response) {
  if (!response?.ok) {
    alert(response?.error || "Could not join the room.");
    return;
  }
  state.room = response.room;
  showScreen("room");
  switchTab("timer", document.querySelector(".side-tab"));
  renderRoom();
  loadWeather();
  setupLocalMedia();
}

function renderRoom() {
  if (!state.room) return;
  document.getElementById("room-topbar-name").textContent = state.room.name;
  const badge = document.getElementById("room-topbar-badge");
  const badgeClass = state.room.type === "neutral" ? "badge-neutral" : state.room.type === "female" ? "badge-female" : "badge-male";
  badge.className = `room-badge ${badgeClass}`;
  badge.textContent = state.room.type === "neutral" ? "All Welcome" : state.room.type === "female" ? "Women Only" : "Men Only";

  document.getElementById("room-time-left").textContent = `${formatShortDuration(state.room.timeLeft)} left`;
  document.getElementById("room-time-fill").style.width = `${Math.max(0, Math.min(100, Math.round((state.room.timeLeft / state.room.timeTotal) * 100)))}%`;

  renderVideoGrid();
  renderMembers();
  renderMessages();
  renderControls();
}

function renderVideoGrid() {
  const grid = document.getElementById("video-grid");
  const members = state.room?.visibleMembers || [];
  const me = buildLocalMember();
  const tiles = [me, ...members.filter((member) => member.clientId !== state.clientId)];
  let html = tiles.map((member) => {
    const isMe = member.clientId === state.clientId;
    const isBreak = Boolean(member.onBreak);
    const tileBody = isMe && state.localStream && state.camOn
      ? `<video class="video-stream" id="local-video" autoplay muted playsinline></video>`
      : `<div class="${isMe ? "video-placeholder" : "video-tile-bg"}" style="background:${member.bg || "rgba(201,147,58,0.08)"};">
          <div class="video-avatar" style="background:${member.bg || "rgba(201,147,58,0.15)"};color:${member.color || "#c9933a"};">
            ${escapeHtml(member.initials || member.name.slice(0, 2))}
          </div>
          <div style="font-size:0.65rem;color:var(--muted2);">${isMe ? (state.camOn ? "Camera on" : "Camera off") : member.camOn === false ? "Camera off" : "Camera on"}</div>
        </div>`;
    return `<div class="video-tile${isMe ? " my-tile" : ""}${isBreak ? " on-break" : ""}">
      ${tileBody}
      ${isBreak ? '<div class="break-badge">On Break</div>' : ""}
      <div class="video-tile-name">
        <span>${escapeHtml(member.name)}${isMe ? " (you)" : ""}</span>
        <span style="font-size:10px;color:var(--green2);">●</span>
      </div>
    </div>`;
  }).join("");

  if (state.room.overflowCount > 0) {
    html += `<div class="video-tile">
      <div class="video-more">
        <div class="video-more-count">+${state.room.overflowCount}</div>
        <div style="font-size:0.75rem;color:var(--muted2);">more studying quietly</div>
      </div>
      <div class="video-tile-name"><span>Room activity</span></div>
    </div>`;
  }

  grid.innerHTML = html;
  attachLocalVideo();
}

function renderMembers() {
  const list = document.getElementById("members-list");
  const members = state.room?.visibleMembers || [];
  const displayMembers = [buildLocalMember(), ...members.filter((member) => member.clientId !== state.clientId)];
  document.getElementById("members-count").textContent = `${state.room?.membersCount || displayMembers.length} members in this room`;

  list.innerHTML = displayMembers.map((member) => {
    const isMe = member.clientId === state.clientId;
    const statusText = member.onBreak ? "On Break" : `${member.status || "Focusing"}${member.subject ? ` — ${member.subject}` : ""}`;
    return `<div class="member-row">
      <div class="member-avatar" style="background:${member.bg};color:${member.color};">${escapeHtml(member.initials)}</div>
      <div class="member-info">
        <div class="member-name">${escapeHtml(member.name)}${isMe ? " (you)" : ""}</div>
        <div class="member-status">${escapeHtml(statusText)}</div>
      </div>
      ${isMe ? "" : `<div class="member-action" onclick="sendBuddyReq('${escapeAttribute(member.name)}')">Connect</div>`}
    </div>`;
  }).join("") + (state.room?.overflowCount ? `<div class="status-note">${state.room.overflowCount} more people are keeping their cameras in audience mode.</div>` : "");
}

function renderMessages() {
  const messages = state.room?.messages || [];
  const el = document.getElementById("chat-messages");
  el.innerHTML = messages.map((message) => {
    const isMe = message.clientId === state.clientId || message.author === "You";
    const classes = isMe ? "chat-msg me" : "chat-msg them";
    return `<div class="${classes}">
      ${!isMe ? `<div class="msg-author">${escapeHtml(message.author)}</div>` : ""}
      ${escapeHtml(message.text)}
    </div>`;
  }).join("");
  el.scrollTop = el.scrollHeight;
}

function renderControls() {
  document.getElementById("mic-btn").textContent = state.micOn ? "🎙" : "🔇";
  document.getElementById("cam-btn").textContent = state.camOn ? "📷" : "🚫";
  document.getElementById("mic-btn").style.opacity = state.micOn ? "1" : "0.5";
  document.getElementById("cam-btn").style.opacity = state.camOn ? "1" : "0.5";
  document.getElementById("break-btn").textContent = state.onBreak ? "☕ On Break" : "☕ Break";
}

function switchTab(name, el) {
  state.activeTab = name;
  document.querySelectorAll(".side-tab").forEach((tab) => tab.classList.remove("active"));
  if (el) el.classList.add("active");
  ["timer", "members", "chat", "settings"].forEach((tabName) => {
    document.getElementById(`tab-${tabName}`).style.display = tabName === name ? "" : "none";
  });
  document.getElementById("chat-input-area").style.display = name === "chat" ? "" : "none";
  if (name === "chat") setTimeout(() => renderMessages(), 30);
}

function sendMsg() {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text || !state.currentRoomId) return;
  socket.emit("chat:send", { roomId: state.currentRoomId, clientId: state.clientId, text });
  input.value = "";
}

function leaveRoom() {
  socket.emit("room:leave");
  state.currentRoomId = null;
  state.room = null;
  state.pendingBuddy = null;
  state.pendingExtend = null;
  clearInterval(state.breakInterval);
  state.breakInterval = null;
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  state.timerRunning = false;
  state.onBreak = false;
  releaseLocalMedia();
  closeNotif("buddy-notif");
  closeNotif("extend-notif");
  document.getElementById("end-modal").classList.remove("show");
  document.getElementById("break-modal").classList.remove("show");
  resetTimer();
  showLobby();
}

function toggleTimer() {
  if (state.timerRunning) pauseTimer();
  else startTimer();
}

function startTimer() {
  if (state.timerRunning) return;
  state.timerRunning = true;
  document.getElementById("timer-start-btn").textContent = "Pause";
  state.timerInterval = setInterval(async () => {
    state.timerSeconds -= 1;
    updateTimerDisplay();
    if (state.timerSeconds > 0) return;
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    state.timerRunning = false;
    document.getElementById("timer-start-btn").textContent = "Start";
    document.getElementById("end-time").textContent = Math.round(state.timerTotal / 60);
    document.getElementById("end-sessions").textContent = state.sessionCount;
    await recordCompletedSession();
    if (state.preferences.focusMode.sessionSummary) document.getElementById("end-modal").classList.add("show");
    else if (state.preferences.focusMode.breakReminders) startBreak();
  }, 1000);
}

function pauseTimer() {
  state.timerRunning = false;
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  document.getElementById("timer-start-btn").textContent = "Resume";
}

function resetTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  state.timerRunning = false;
  state.timerSeconds = state.timerTotal;
  document.getElementById("timer-start-btn").textContent = "Start";
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const minutes = Math.floor(state.timerSeconds / 60);
  const seconds = state.timerSeconds % 60;
  document.getElementById("timer-display").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  document.getElementById("timer-progress-fill").style.width = `${(state.timerSeconds / state.timerTotal) * 100}%`;
  document.getElementById("session-counter").textContent = `Session ${state.sessionCount} of ${state.totalSessions}`;
}

function setPomLength(minutes, button, shouldPersist = true) {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  state.timerRunning = false;
  state.timerTotal = minutes * 60;
  state.timerSeconds = state.timerTotal;
  state.preferences.pomodoroLength = minutes;
  syncPomodoroUi(minutes, button);
  document.getElementById("timer-start-btn").textContent = "Start";
  updateTimerDisplay();
  if (shouldPersist) persistPreferences({ pomodoroLength: minutes });
}

function nextSession() {
  state.sessionCount = state.sessionCount >= state.totalSessions ? 1 : state.sessionCount + 1;
  document.getElementById("end-modal").classList.remove("show");
  state.timerSeconds = state.timerTotal;
  updateTimerDisplay();
  startTimer();
}

function startBreak() {
  if (state.onBreak) return;
  state.onBreak = true;
  pauseTimer();
  state.breakSeconds = 5 * 60;
  document.getElementById("break-modal").classList.add("show");
  renderControls();
  syncMemberState();
  state.breakInterval = setInterval(() => {
    state.breakSeconds -= 1;
    document.getElementById("break-countdown").textContent = formatClock(state.breakSeconds);
    document.getElementById("break-progress").style.width = `${(state.breakSeconds / (5 * 60)) * 100}%`;
    if (state.breakSeconds <= 0) endBreakEarly();
  }, 1000);
}

function endBreakEarly() {
  clearInterval(state.breakInterval);
  state.breakInterval = null;
  state.onBreak = false;
  document.getElementById("break-modal").classList.remove("show");
  renderControls();
  syncMemberState();
}

function toggleMic() {
  state.micOn = !state.micOn;
  if (state.localStream) {
    state.localStream.getAudioTracks().forEach((track) => {
      track.enabled = state.micOn;
    });
  }
  renderControls();
  syncMemberState();
}

async function toggleCam() {
  state.camOn = !state.camOn;
  if (state.camOn && !state.localStream) await setupLocalMedia();
  if (state.localStream) {
    state.localStream.getVideoTracks().forEach((track) => {
      track.enabled = state.camOn;
    });
  }
  renderControls();
  renderVideoGrid();
  syncMemberState();
}

async function setupLocalMedia() {
  if (state.localStream || state.mediaPending || !navigator.mediaDevices?.getUserMedia) return;
  state.mediaPending = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    state.localStream = stream;
    stream.getAudioTracks().forEach((track) => { track.enabled = state.micOn; });
    stream.getVideoTracks().forEach((track) => { track.enabled = state.camOn; });
    attachLocalVideo();
  } catch (_error) {
    state.camOn = false;
    state.micOn = false;
    renderControls();
  } finally {
    state.mediaPending = false;
  }
}

function attachLocalVideo() {
  const video = document.getElementById("local-video");
  if (video && state.localStream) {
    video.srcObject = state.localStream;
  }
}

function releaseLocalMedia() {
  if (!state.localStream) return;
  state.localStream.getTracks().forEach((track) => track.stop());
  state.localStream = null;
}

function voteExtend() {
  if (!state.currentRoomId) return;
  socket.emit("room:vote-extend", { roomId: state.currentRoomId, clientId: state.clientId });
}

function respondExtendVote(accept) {
  if (!state.pendingExtend) {
    closeNotif("extend-notif");
    return;
  }
  socket.emit("room:extend-response", { roomId: state.pendingExtend.roomId, accept });
  if (!accept) closeNotif("extend-notif");
}

function sendBuddyReq(name) {
  if (!state.currentRoomId) return;
  socket.emit("buddy:request", { roomId: state.currentRoomId, name });
}

function acceptBuddy() {
  closeNotif("buddy-notif");
  switchTab("chat", document.querySelectorAll(".side-tab")[2]);
}

function declineBuddy() {
  closeNotif("buddy-notif");
  state.pendingBuddy = null;
}

function closeNotif(id) {
  document.getElementById(id).classList.remove("show");
}

function setTheme(theme, element, shouldPersist = true) {
  state.preferences.theme = theme;
  syncThemeUi(theme, element);
  if (shouldPersist) persistPreferences({ theme });
}

function applyPreferences(preferences, options = {}) {
  state.preferences = {
    ...state.preferences,
    ...preferences,
    sounds: { ...state.preferences.sounds, ...(preferences.sounds || {}) },
    focusMode: { ...state.preferences.focusMode, ...(preferences.focusMode || {}) },
  };

  syncPomodoroUi(state.preferences.pomodoroLength || 25);
  syncThemeUi(state.preferences.theme || "default");
  if (options.hydrateTimer) {
    state.timerTotal = (state.preferences.pomodoroLength || 25) * 60;
    state.timerSeconds = state.timerTotal;
  }
  setToggleClass("t-lofi", state.preferences.sounds.lofi);
  setToggleClass("t-rain", state.preferences.sounds.rain);
  setToggleClass("t-cafe", state.preferences.sounds.cafe);
  setToggleClass("focus-camera-required", state.preferences.focusMode.cameraRequired);
  setToggleClass("focus-break-reminders", state.preferences.focusMode.breakReminders);
  setToggleClass("focus-session-summary", state.preferences.focusMode.sessionSummary);
  updateTimerDisplay();
}

function syncPomodoroUi(minutes, button) {
  document.querySelectorAll('[id^="pom-"]').forEach((btn) => btn.classList.remove("active"));
  const activeButton = button || document.getElementById(`pom-${minutes}`) || document.getElementById("pom-25");
  if (activeButton) activeButton.classList.add("active");
}

function syncThemeUi(theme, element) {
  document.querySelectorAll(".theme-option").forEach((option) => option.classList.remove("active"));
  const activeElement = element || Array.from(document.querySelectorAll(".theme-option")).find((option) => (option.getAttribute("onclick") || "").includes(`'${theme}'`));
  if (activeElement) activeElement.classList.add("active");
  document.body.classList.remove("theme-cafe", "theme-night", "theme-forest");
  if (theme !== "default") document.body.classList.add(`theme-${theme}`);
}

function toggleSound(key, element) {
  const nextValue = !state.preferences.sounds[key];
  state.preferences.sounds[key] = nextValue;
  element.classList.toggle("on", nextValue);
  toggleAmbientAudio(key, nextValue);
  persistPreferences({ sounds: state.preferences.sounds });
}

function toggleFocusSetting(key, element) {
  const nextValue = !state.preferences.focusMode[key];
  state.preferences.focusMode[key] = nextValue;
  element.classList.toggle("on", nextValue);
  persistPreferences({ focusMode: state.preferences.focusMode });
}

function toggleAmbientAudio(key, enabled) {
  const context = ensureAudioContext();
  if (!context) return;

  if (!enabled && state.audio.sources[key]) {
    state.audio.sources[key].stop();
    delete state.audio.sources[key];
    return;
  }

  if (enabled && !state.audio.sources[key]) {
    state.audio.sources[key] = key === "lofi" ? createLofiSource(context) : createNoiseSource(context, key);
    state.audio.sources[key].start();
  }
}

function ensureAudioContext() {
  if (!window.AudioContext && !window.webkitAudioContext) return null;
  if (!state.audio.context) state.audio.context = new (window.AudioContext || window.webkitAudioContext)();
  if (state.audio.context.state === "suspended") state.audio.context.resume();
  return state.audio.context;
}

function createLofiSource(context) {
  const gain = context.createGain();
  const oscA = context.createOscillator();
  const oscB = context.createOscillator();
  oscA.type = "sine";
  oscB.type = "triangle";
  oscA.frequency.value = 196;
  oscB.frequency.value = 247;
  gain.gain.value = 0.018;
  oscA.connect(gain);
  oscB.connect(gain);
  gain.connect(context.destination);
  return {
    start() { oscA.start(); oscB.start(); },
    stop() { oscA.stop(); oscB.stop(); gain.disconnect(); },
  };
}

function createNoiseSource(context, key) {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  source.loop = true;
  filter.type = key === "rain" ? "highpass" : "bandpass";
  filter.frequency.value = key === "rain" ? 800 : 1200;
  gain.gain.value = key === "rain" ? 0.012 : 0.01;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  return {
    start() { source.start(); },
    stop() { source.stop(); gain.disconnect(); },
  };
}

async function persistPreferences(partial) {
  await fetch("/api/preferences", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(partial),
  }).catch(() => {});
}

async function loadWeather() {
  document.getElementById("weather-desc").textContent = "Checking the local weather...";
  try {
    const coords = await getCurrentPosition();
    const response = await fetch(`/api/weather?lat=${coords.latitude}&lon=${coords.longitude}`);
    const weather = await response.json();
    document.getElementById("weather-icon").textContent = weather.icon;
    document.getElementById("weather-temp").textContent = `${weather.temp}°C`;
    document.getElementById("weather-desc").textContent = weather.desc;
    document.getElementById("weather-city").textContent = weather.city;
  } catch (_error) {
    const response = await fetch("/api/weather");
    const weather = await response.json();
    document.getElementById("weather-icon").textContent = weather.icon;
    document.getElementById("weather-temp").textContent = `${weather.temp}°C`;
    document.getElementById("weather-desc").textContent = weather.desc;
    document.getElementById("weather-city").textContent = weather.city;
  }
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position.coords),
      reject,
      { enableHighAccuracy: false, timeout: 8000 },
    );
  });
}

async function recordCompletedSession() {
  try {
    const response = await fetch("/api/session-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes: Math.round(state.timerTotal / 60), roomId: state.currentRoomId }),
    });
    const payload = await response.json();
    state.dashboard = payload.dashboard;
    state.bootstrap = { ...(state.bootstrap || {}), dashboard: payload.dashboard, leaderboard: payload.leaderboard };
    renderLeaderboard();
  } catch (_error) {
    return null;
  }
}

function syncMemberState() {
  if (!state.currentRoomId) return;
  socket.emit("member:update", {
    roomId: state.currentRoomId,
    clientId: state.clientId,
    onBreak: state.onBreak,
    micOn: state.micOn,
    camOn: state.camOn,
    status: state.onBreak ? "On Break" : "Focusing",
  });
}

function buildLocalMember() {
  return {
    clientId: state.clientId,
    name: "You",
    initials: state.bootstrap?.user?.initials || "ME",
    color: "#c9933a",
    bg: "rgba(201,147,58,0.2)",
    status: state.onBreak ? "On Break" : "Focusing",
    subject: state.room?.subject || "Focus",
    onBreak: state.onBreak,
    micOn: state.micOn,
    camOn: state.camOn,
  };
}

function setToggleClass(id, enabled) {
  const element = document.getElementById(id);
  if (element) element.classList.toggle("on", Boolean(enabled));
}

function formatClock(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatShortDuration(minutes) {
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function formatMinutesLong(minutes) {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

function formatCompactHours(hours) {
  if (hours >= 1000) return `${(hours / 1000).toFixed(1)}k`;
  return `${hours}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return String(value).replaceAll("'", "\\'");
}

function getOrCreateClientId() {
  const key = "coffee-concepts-client-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = `client-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(key, created);
  return created;
}

Object.assign(window, {
  showLobby,
  showDashboard,
  closeDashboard,
  openCreateRoom,
  closeCreateRoom,
  joinRoom,
  leaveRoom,
  switchTab,
  sendMsg,
  toggleTimer,
  resetTimer,
  setPomLength,
  nextSession,
  startBreak,
  endBreakEarly,
  toggleMic,
  toggleCam,
  voteExtend,
  respondExtendVote,
  sendBuddyReq,
  acceptBuddy,
  declineBuddy,
  closeNotif,
  setTheme,
  toggleSound,
  toggleFocusSetting,
});
