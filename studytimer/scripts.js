// Enhanced Study Timer - Coffee & Concepts
// Features: Pomodoro presets, auto-break, localStorage streaks, secure APIs, alerts

// Common Utility: Format Time
function formatTime(seconds, showHours = true) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const sec = seconds % 60;
    return showHours
        ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
        : `${String(minutes).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Load/Save streak to localStorage
function loadStreak() {
    return parseInt(localStorage.getItem('studyStreak') || '0');
}
function saveStreak(streak) {
    localStorage.setItem('studyStreak', streak.toString());
    document.getElementById('streak-count').textContent = streak;
}
function updateStreakDisplay() {
    const streak = loadStreak();
    document.getElementById('streak-count').textContent = streak;
}

// Alert sound (beep)
function playAlert() {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1);
    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 1);
}

// Update progress circle
function updateProgress(seconds, max) {
    const progress = 1 - (seconds / max);
    const fill = document.getElementById('progress-fill');
    if (fill) {
        fill.style.strokeDasharray = `${progress * 327} 327`;
    }
}

// Main Timer Logic
let mainTimerInterval, mainTime = 0, mainMaxTime = 0;
let isBreakMode = false;

function startMainTimerFromInput() {
    const userTime = document.getElementById('user-time')?.value;
    if (!userTime) return;

    const timeParts = userTime.split(':');
    mainTime = timeParts.length === 3 
        ? (parseInt(timeParts[0])||0)*3600 + (parseInt(timeParts[1])||0)*60 + (parseInt(timeParts[2])||0)
        : (parseInt(timeParts[0])||0)*60 + (parseInt(timeParts[1])||0);
    
    if (mainTime <= 0) return;

    mainMaxTime = mainTime;
    document.getElementById('main-timer').innerText = formatTime(mainTime);
    updateProgress(mainTime, mainMaxTime);
    document.getElementById('user-time').value = '';

    if (mainTimerInterval) clearInterval(mainTimerInterval);
    mainTimerInterval = setInterval(() => {
        if (mainTime > 0) {
            mainTime--;
            document.getElementById('main-timer').innerText = formatTime(mainTime);
            updateProgress(mainTime, mainMaxTime);
        } else {
            stopMainTimer();
            playAlert();
            alert(isBreakMode ? "Break over! Back to focus!" : "Focus session complete! Take a break?");
            if (!isBreakMode) {
                // Auto start 5min break
                isBreakMode = true;
                document.getElementById('break-timer-display').innerText = '05:00';
                startBreakTimer();
            } else {
                isBreakMode = false;
            }
            updateStreakDisplay(); // Update on session end
        }
    }, 1000);
}

function stopMainTimer() {
    if (mainTimerInterval) {
        clearInterval(mainTimerInterval);
        mainTimerInterval = null;
    }
}

function resetMainTimer() {
    stopMainTimer();
    mainTime = 0;
    mainMaxTime = 0;
    isBreakMode = false;
    document.getElementById('main-timer').innerText = "00:00:00";
    document.getElementById('user-time').value = "";
    updateProgress(0, 1);
}

// Preset buttons
document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.getElementById('user-time').value = formatTime(parseInt(btn.dataset.time), false);
    });
});

// Font size slider
document.getElementById('font-size-slider').addEventListener('input', function() {
    const size = this.value;
    document.getElementById('main-timer').style.fontSize = size + 'px';
    document.getElementById('font-size-label').textContent = size + 'px';
});

// Stopwatch Logic (unchanged)
let stopwatchTime = 0, stopwatchInterval = null;
function startStopwatch() {
    if (stopwatchInterval) return;
    stopwatchInterval = setInterval(() => {
        stopwatchTime++;
        document.getElementById('stopwatch-display').innerText = formatTime(stopwatchTime);
    }, 1000);
}
function stopStopwatch() { clearInterval(stopwatchInterval); stopwatchInterval = null; }
function resetStopwatch() {
    stopStopwatch();
    stopwatchTime = 0;
    document.getElementById('stopwatch-display').innerText = "00:00:00";
}

// Break Timer (5min default)
let breakTimerInterval, breakTimeRemaining = 300;
function startBreakTimer() {
    stopBreakTimer();
    breakTimerInterval = setInterval(() => {
        if (breakTimeRemaining > 0) {
            breakTimeRemaining--;
            document.getElementById('break-timer-display').innerText = formatTime(breakTimeRemaining, false);
        } else {
            stopBreakTimer();
            playAlert();
            alert("Break over!");
        }
    }, 1000);
}
function stopBreakTimer() { if (breakTimerInterval) clearInterval(breakTimerInterval); }
function resetBreakTimer() {
    stopBreakTimer();
    breakTimeRemaining = 300;
    document.getElementById('break-timer-display').innerText = "05:00";
}

// Background & Music (unchanged)
let currentBackgroundType = null;
function uploadBackground() {
    const file = document.getElementById('upload-background').files[0];
    const background = document.getElementById('background');
    if (!file || !background) return;
    background.innerHTML = "";
    const url = URL.createObjectURL(file);
    if (file.type.includes('image')) {
        const img = document.createElement('img');
        img.src = url; img.id = "bg-media";
        background.appendChild(img);
        currentBackgroundType = 'image';
    } else if (file.type.includes('video')) {
        const video = document.createElement('video');
        video.src = url; video.autoplay = video.loop = true; video.muted = true; video.id = "bg-media";
        background.appendChild(video);
        currentBackgroundType = 'video';
    }
    stretchBackground(true);
}
function stretchBackground(stretch) {
    const media = document.getElementById('bg-media');
    if (media) {
        media.style.position = "absolute"; media.style.top = media.style.left = "0";
        media.style.width = stretch ? "100%" : "auto"; media.style.height = stretch ? "100%" : "auto";
        media.style.objectFit = stretch ? "cover" : "contain"; media.style.zIndex = "-1";
    }
}
let music = null;
function uploadMusic() {
    const file = document.getElementById('upload-music').files[0];
    if (file) music = new Audio(URL.createObjectURL(file));
}
function playMusic() { if (music) music.play(); }
function pauseMusic() { if (music) music.pause(); }

// Theme toggle
let currentTheme = 'dark';
function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.body.classList.toggle('light-theme', currentTheme === 'light');
    document.getElementById('theme-toggle').querySelector('i').className = currentTheme === 'dark' ? 'ph ph-moon' : 'ph ph-sun';
}

// Fullscreen
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

// Color picker
function changeTimerColor() {
    const color = document.getElementById('timer-color').value;
    document.getElementById('main-timer').style.color = color;
}

// Menu toggles (unchanged)
function toggleMenu() {
    document.getElementById("menu-options").classList.toggle("hide");
    document.getElementById("hamburger").classList.toggle("active");
}
function toggleFeature(key) {
    const featureMap = {
        'stopwatch': 'stopwatch', 'break': 'break-timer', 'bg': 'background-options',
        'music': 'music-options', 'color': 'color-picker', 'weather': 'weather-tool',
        'main-timer': 'main-timer-controls'
    };
    const featureId = featureMap[key];
    const feature = document.getElementById(featureId);
    if (feature) feature.classList.toggle("hidden");
    const btn = event.target.closest('.toggle-btn');
    if (btn) btn.classList.toggle('active');
}

// Secure Weather (prompt for API key)
async function getLocation() {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            pos => resolve({lat: pos.coords.latitude, lon: pos.coords.longitude}),
            () => reject("Geolocation denied")
        );
    });
}
async function fetchWeather() {
    const apiKey = document.getElementById('weather-api-key').value.trim();
    if (!apiKey) return alert("Enter WeatherAPI.com key");
    
    const weatherEl = document.getElementById('weather');
    try {
        const {lat, lon} = await getLocation();
        const res = await fetch(`https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${lat},${lon}&aqi=yes`);
        const data = await res.json();
        const {temp_c, condition, wind_kph} = data.current;
        const aqi = data.current.air_quality?.['pm2_5']?.toFixed(1) || 'N/A';
        weatherEl.innerHTML = `
            <div class="weather-box">
                <img src="https:${condition.icon}" alt="${condition.text}">
                <div>🌡 ${temp_c}°C<br>${condition.text}<br>💨 ${wind_kph}kph<br>🌫 AQI: ${aqi}</div>
            </div>
        `;
    } catch (err) {
        weatherEl.innerHTML = `<div class="loading-state">Error: ${err.message}</div>`;
    }
}

// Init
updateStreakDisplay();

