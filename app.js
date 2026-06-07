const SUPABASE_URL = "https://huyifomichrbcvxxwmtm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1eWlmb21pY2hyYmN2eHh3bXRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3OTUxMjMsImV4cCI6MjA5NjM3MTEyM30.TZRAA5I-0zj3-N_Thof5sGCBCzGs1IkqjXtxzVinyHI";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

let authMode = "login";
let currentUser = null;
let currentSession = null;
let cloudData = null;

let timer = null;
let timerLeft = 25 * 60;
let timerTotal = 25 * 60;
let timerRunning = false;
let audioCtx = null;
let currentSoundNodes = [];
let studyStartedAt = null;
let saveTimer = null;

const todayKey = () => new Date().toISOString().slice(0,10);
const uid = () => Math.random().toString(36).slice(2,10);

function escapeHtml(str){
  return String(str ?? "").replace(/[&<>"']/g, m=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

function defaultData(email){
  const name = email?.split("@")[0] || "朋友";
  return {
    profile:{ name, avatar:"💧", theme:"light", numberFont:"Quicksand" },
    daily:[],
    tasks:[],
    countdowns:[],
    logs:{},
    notes:{},
    room:null
  };
}

function getData(){
  return cloudData;
}

function saveData(data){
  cloudData = data;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCloudData, 350);
}

async function saveCloudData(){
  if(!currentSession?.user || !cloudData) return;
  const { error } = await supabaseClient
    .from("app_data")
    .upsert({
      user_id: currentSession.user.id,
      data: cloudData,
      updated_at: new Date().toISOString()
    });
  if(error) console.error("保存失败：", error);
}

async function loadCloudData(session){
  const { data, error } = await supabaseClient
    .from("app_data")
    .select("data")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if(error){
    console.error("读取失败：", error);
  }

  if(data?.data){
    cloudData = data.data;
  }else{
    cloudData = defaultData(session.user.email);
    await supabaseClient
      .from("app_data")
      .insert({ user_id: session.user.id, data: cloudData });
  }
}

function logEvent(text, minutes=0, type="记录"){
  const data = getData();
  const day = todayKey();
  if(!data.logs[day]) data.logs[day] = [];
  data.logs[day].push({
    id:uid(),
    text,
    minutes:Math.round(minutes),
    type,
    time:new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})
  });
  saveData(data);
  renderCalendar();
}

function initAuth(){
  $$(".tab").forEach(btn=>{
    btn.onclick=()=>{
      authMode = btn.dataset.auth;
      $$(".tab").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      $("#authBtn").textContent = authMode === "login" ? "进入小水滴" : "注册并进入";
      $("#authMsg").textContent = "";
    };
  });

  $$(".social").forEach(btn=>{
    btn.onclick=async()=>{
      const provider = btn.dataset.provider;
      if(provider !== "Google"){
        $("#authMsg").textContent = `${provider} 登录需要国内开发者平台审核，先预留入口。`;
        return;
      }
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider:"google",
        options:{
          redirectTo: window.location.origin + window.location.pathname
        }
      });
      if(error) $("#authMsg").textContent = error.message;
    };
  });

  $("#authBtn").onclick=async()=>{
    const email = $("#authId").value.trim();
    const password = $("#authPwd").value.trim();

    if(!email || !password){
      $("#authMsg").textContent = "邮箱和密码都要填。";
      return;
    }

    $("#authMsg").textContent = "正在处理…";

    let result;
    if(authMode === "register"){
      result = await supabaseClient.auth.signUp({ email, password });
      if(result.error){
        $("#authMsg").textContent = result.error.message;
        return;
      }
      if(!result.data.session){
        $("#authMsg").textContent = "注册成功。请去邮箱确认后再登录。";
        return;
      }
    }else{
      result = await supabaseClient.auth.signInWithPassword({ email, password });
      if(result.error){
        $("#authMsg").textContent = result.error.message;
        return;
      }
    }

    await enterApp(result.data.session);
  };
}

async function enterApp(session){
  currentSession = session;
  currentUser = session.user.email;
  await loadCloudData(session);

  $("#authPage").classList.add("hidden");
  $("#mainPage").classList.remove("hidden");
  applyProfile(getData().profile);
  renderAll();
}

function applyProfile(profile){
  document.body.classList.toggle("dark", profile.theme === "dark");
  document.documentElement.style.setProperty("--num", `"${profile.numberFont || "Quicksand"}", sans-serif`);
  $("#themeToggle").textContent = profile.theme === "dark" ? "白天" : "夜间";
  $("#helloText").textContent = `${profile.name || "朋友"}，今天也慢慢来。`;
}

function initNav(){
  $$(".nav-btn").forEach(btn=>{
    btn.onclick=()=>{
      $$(".nav-btn").forEach(b=>b.classList.remove("active"));
      $$(".page").forEach(p=>p.classList.remove("active"));
      btn.classList.add("active");
      $("#" + btn.dataset.page).classList.add("active");
      if(btn.dataset.page === "calendar") renderCalendar();
    };
  });

  $("#themeToggle").onclick=()=>{
    const data = getData();
    data.profile.theme = data.profile.theme === "dark" ? "light" : "dark";
    saveData(data);
    applyProfile(data.profile);
  };

  $("#logoutBtn").onclick=async()=>{
    await saveCloudData();
    await supabaseClient.auth.signOut();
    location.reload();
  };
}

function tickClock(){
  const now = new Date();
  $("#clockTime").textContent = now.toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
  $("#clockDate").textContent = now.toLocaleDateString("zh-CN",{year:"numeric",month:"long",day:"numeric",weekday:"long"});

  const lines = [
    "慢慢来，也是在向前走。",
    "完成一点点，也值得开心。",
    "今天已经很努力了。",
    "不用急，你有自己的节奏。",
    "喝口水，休息一下，再继续。"
  ];
  $("#warmText").textContent = lines[now.getDate() % lines.length];
}
setInterval(tickClock, 1000);

function initAudio(){
  $$(".sound-btn").forEach(btn=>{
    btn.onclick=()=>{
      const type = btn.dataset.sound;
      stopSound();
      $$(".sound-btn").forEach(b=>b.classList.remove("active"));
      if(type !== "none"){
        startSound(type);
        btn.classList.add("active");
      }
    };
  });

  $("#soundVolume").oninput=()=>{
    currentSoundNodes.forEach(n=>{
      if(n && n.gain) n.gain.value = Number($("#soundVolume").value) / 1200;
    });
  };

  $("#playerToggle").onclick=()=>{
    $("#floatingPlayer").classList.toggle("collapsed");
    $("#playerToggle").textContent = $("#floatingPlayer").classList.contains("collapsed") ? "音乐播放器 ▲" : "音乐播放器 ▼";
  };

  $("#loadMusic").onclick=()=>{
    const url = $("#musicUrl").value.trim();
    if(!url) return;
    $("#floatingPlayer").classList.remove("collapsed");
    $("#playerToggle").textContent = "音乐播放器 ▼";
    $("#embedBox").innerHTML = makeEmbed(url);
  };
}

function ensureAudio(){
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if(audioCtx.state === "suspended") audioCtx.resume();
}
function stopSound(){
  currentSoundNodes.forEach(n=>{
    try{
      if(n._interval) clearInterval(n._interval);
      n.stop?.();
      n.disconnect?.();
    }catch(e){}
  });
  currentSoundNodes = [];
}
function makeNoiseSource(kind="pink"){
  const bufferSize = audioCtx.sampleRate * 3;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const out = buffer.getChannelData(0);
  let last = 0;
  for(let i=0;i<bufferSize;i++){
    const white = Math.random()*2-1;
    if(kind === "brown"){
      last = (last + 0.012 * white) / 1.012;
      out[i] = last * 1.55;
    }else{
      last = 0.965 * last + 0.035 * white;
      out[i] = last * .72 + white * .05;
    }
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}
function softTone(freq, duration=.08, volume=.004){
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(volume, audioCtx.currentTime + .02);
  g.gain.exponentialRampToValueAtTime(.0001, audioCtx.currentTime + duration);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration + .02);
  currentSoundNodes.push(osc,g);
}
function startSound(type){
  ensureAudio();
  const gain = audioCtx.createGain();
  gain.gain.value = Number($("#soundVolume").value || 24) / 1200;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = type === "rain" ? 1500 : type === "forest" ? 850 : type === "cafe" ? 690 : type === "library" ? 520 : 420;
  filter.Q.value = .28;

  const src = makeNoiseSource(type === "brown" ? "brown" : "pink");
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  src.start();

  currentSoundNodes.push(src, filter, gain);

  if(type === "rain"){
    gain._interval = setInterval(()=>softTone(1100 + Math.random()*600, .04, .0024), 700 + Math.random()*850);
  }
  if(type === "forest"){
    gain._interval = setInterval(()=>softTone(520 + Math.random()*380, .16, .003), 2400 + Math.random()*2500);
  }
  if(type === "library"){
    gain._interval = setInterval(()=>softTone(130 + Math.random()*70, .05, .0018), 3600 + Math.random()*3200);
  }
  if(type === "cafe"){
    gain._interval = setInterval(()=>softTone(180 + Math.random()*160, .06, .0018), 1300 + Math.random()*1800);
  }
}
function getYoutubeId(raw){
  try{
    const u = new URL(raw);
    if(u.hostname.includes("youtu.be")) return u.pathname.replace("/","").split("?")[0];
    if(u.searchParams.get("v")) return u.searchParams.get("v");
    const embed = u.pathname.match(/\/embed\/([\w-]+)/);
    if(embed) return embed[1];
  }catch(e){}
  const m = raw.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{8,})/);
  return m ? m[1] : null;
}
function makeEmbed(url){
  const yt = getYoutubeId(url);
  if(yt){
    return `<iframe src="https://www.youtube.com/embed/${yt}?autoplay=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>
    <p class="hint">如果某个视频不允许内嵌，就只能打开原网站播放。<br><a target="_blank" href="https://www.youtube.com/watch?v=${yt}">直接打开 YouTube</a></p>`;
  }
  const bili = url.match(/bilibili\.com\/video\/(BV[\w]+)/);
  if(bili){
    return `<iframe src="https://player.bilibili.com/player.html?bvid=${bili[1]}&autoplay=1" allowfullscreen></iframe>`;
  }
  if(url.includes("music.apple.com")){
    const embed = url.replace("https://music.apple.com","https://embed.music.apple.com");
    return `<iframe allow="autoplay *; encrypted-media *;" sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-top-navigation-by-user-activation" src="${embed}"></iframe>`;
  }
  return `<div class="embed-fallback"><p>这个链接不支持直接内嵌。<br><a href="${escapeHtml(url)}" target="_blank">点这里打开</a></p></div>`;
}

function initPomodoro(){
  timerTotal = Number($("#focusMinutes").value) * 60;
  timerLeft = timerTotal;
  renderTimer();

  $("#focusMinutes").onchange=()=>{
    if(timerRunning) return;
    timerTotal = Number($("#focusMinutes").value) * 60;
    timerLeft = timerTotal;
    renderTimer();
  };

  $("#startTimer").onclick=()=>{
    if(timerRunning) return;
    timerRunning = true;
    $("#timerStatus").textContent = "专注中";
    timer = setInterval(()=>{
      timerLeft--;
      renderTimer();
      if(timerLeft <= 0){
        clearInterval(timer);
        timerRunning = false;
        const mins = Number($("#focusMinutes").value);
        const project = $("#focusProject").value.trim() || "未命名专注";
        logEvent(`番茄钟：${project}`, mins, "专注");
        $("#timerStatus").textContent = "已完成";
        timerTotal = Number($("#breakMinutes").value) * 60;
        timerLeft = timerTotal;
        renderTimer();
      }
    },1000);
  };

  $("#pauseTimer").onclick=()=>{
    clearInterval(timer);
    timerRunning = false;
    $("#timerStatus").textContent = "已暂停";
  };

  $("#resetTimer").onclick=()=>{
    clearInterval(timer);
    timerRunning = false;
    timerTotal = Number($("#focusMinutes").value) * 60;
    timerLeft = timerTotal;
    $("#timerStatus").textContent = "准备开始";
    renderTimer();
  };
}
function renderTimer(){
  const m = String(Math.floor(timerLeft/60)).padStart(2,"0");
  const s = String(timerLeft%60).padStart(2,"0");
  $("#timerDisplay").textContent = `${m}:${s}`;
  const done = timerTotal ? (1 - timerLeft / timerTotal) : 0;
  $("#timerRing").style.setProperty("--progress", `${Math.max(0,Math.min(1,done))*360}deg`);
}

function initTodos(){
  $("#addDaily").onclick=()=>{
    const title = $("#dailyInput").value.trim();
    if(!title) return;
    const data = getData();
    data.daily.push({id:uid(), title, count:0});
    $("#dailyInput").value = "";
    saveData(data);
    renderTodos();
  };

  $("#addTask").onclick=()=>{
    const title = $("#taskInput").value.trim();
    if(!title) return;
    const data = getData();
    data.tasks.push({id:uid(), title, done:false, progress:0});
    $("#taskInput").value = "";
    saveData(data);
    renderTodos();
  };
}
function renderTodos(){
  const data = getData();

  $("#dailyList").innerHTML = data.daily.map(d=>`
    <div class="item">
      <div class="item-top">
        <span class="item-title">${escapeHtml(d.title)}</span>
        <div class="item-actions">
          <button class="mini soft-btn" onclick="checkDaily('${d.id}')">打卡</button>
          <button class="mini soft-btn" onclick="deleteDaily('${d.id}')">删除</button>
        </div>
      </div>
      <p class="hint">已经打卡 ${d.count || 0} 次</p>
    </div>
  `).join("") || `<p class="hint">还没有 Daily。</p>`;

  $("#taskList").innerHTML = data.tasks.map(t=>`
    <div class="item">
      <div class="item-top">
        <span class="item-title">${t.done ? "✅" : "○"} ${escapeHtml(t.title)}</span>
        <div class="item-actions">
          <button class="mini soft-btn" onclick="toggleTask('${t.id}')">${t.done ? "取消" : "完成"}</button>
          <button class="mini soft-btn" onclick="deleteTask('${t.id}')">删除</button>
        </div>
      </div>
      <label>进度：${t.progress || 0}%</label>
      <input type="range" min="0" max="100" value="${t.progress || 0}" oninput="setProgress('${t.id}', this.value)">
      <div class="progress"><span style="width:${t.progress || 0}%"></span></div>
    </div>
  `).join("") || `<p class="hint">还没有普通任务。</p>`;
}
window.checkDaily = id=>{
  const data = getData();
  const d = data.daily.find(x=>x.id===id);
  if(d){
    d.count = (d.count || 0) + 1;
    saveData(data);
    logEvent(`Daily 打卡：${d.title}`,0,"Daily");
    renderTodos();
  }
};
window.deleteDaily = id=>{
  const data = getData();
  data.daily = data.daily.filter(x=>x.id!==id);
  saveData(data);
  renderTodos();
};
window.toggleTask = id=>{
  const data = getData();
  const t = data.tasks.find(x=>x.id===id);
  if(t){
    t.done = !t.done;
    if(t.done){
      t.progress = 100;
      logEvent(`完成任务：${t.title}`,0,"任务");
    }
    saveData(data);
    renderTodos();
  }
};
window.deleteTask = id=>{
  const data = getData();
  data.tasks = data.tasks.filter(x=>x.id!==id);
  saveData(data);
  renderTodos();
};
window.setProgress = (id,val)=>{
  const data = getData();
  const t = data.tasks.find(x=>x.id===id);
  if(t){
    t.progress = Number(val);
    saveData(data);
    renderTodos();
  }
};

function initCountdowns(){
  $("#addCountdown").onclick=()=>{
    const title = $("#countTitle").value.trim();
    const date = $("#countDate").value;
    const folder = $("#countFolder").value;
    if(!title || !date) return;

    const data = getData();
    data.countdowns.push({id:uid(), title, date, folder});
    $("#countTitle").value = "";
    $("#countDate").value = "";
    saveData(data);
    renderCountdowns();
  };
}
function renderCountdowns(){
  const data = getData();
  $("#countdownList").innerHTML = data.countdowns.map(c=>{
    const diff = Math.ceil((new Date(c.date) - new Date(todayKey())) / 86400000);
    return `<div class="count-card">
      <span class="folder-tag">${escapeHtml(c.folder)}</span>
      <h3>${escapeHtml(c.title)}</h3>
      <div class="days">${diff}</div>
      <p class="hint">${diff >= 0 ? `还有 ${diff} 天` : `已经过去 ${Math.abs(diff)} 天`} · ${c.date}</p>
      <button class="mini soft-btn" onclick="deleteCountdown('${c.id}')">删除</button>
    </div>`;
  }).join("") || `<p class="hint">还没有倒数日。</p>`;
}
window.deleteCountdown = id=>{
  const data = getData();
  data.countdowns = data.countdowns.filter(x=>x.id!==id);
  saveData(data);
  renderCountdowns();
};

function initCalendar(){
  $("#saveNote").onclick=()=>{
    const data = getData();
    data.notes[todayKey()] = $("#dailyNote").value.trim();
    saveData(data);
    renderCalendar();
  };
}
function renderCalendar(){
  if(!currentUser || !cloudData) return;
  const data = getData();
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const last = new Date(y,m+1,0);
  let html = "";

  for(let i=1;i<=last.getDate();i++){
    const key = new Date(y,m,i).toISOString().slice(0,10);
    const logs = data.logs[key] || [];
    const minutes = logs.reduce((s,l)=>s+(l.minutes||0),0);
    html += `<div class="day-cell">
      <strong>${i}</strong>
      <div class="hint">${minutes ? `${minutes} 分钟` : ""}</div>
      ${logs.slice(-4).map(l=>`<div class="day-event">• ${escapeHtml(l.text)} ${l.minutes ? `(${l.minutes}m)` : ""}</div>`).join("")}
      ${data.notes[key] ? `<div class="day-event">📝 ${escapeHtml(data.notes[key]).slice(0,28)}</div>` : ""}
    </div>`;
  }

  $("#calendarGrid").innerHTML = html;
  $("#dailyNote").value = data.notes[todayKey()] || "";
}

function initStudyRoom(){
  $("#joinRoom").onclick=()=>{
    const data = getData();
    data.room = {
      name:$("#roomName").value.trim() || "小水滴自习室",
      code:$("#roomCode").value.trim() || "0000",
      what:data.room?.what || "",
      todayMinutes:data.room?.todayMinutes || 0
    };
    saveData(data);
    renderRoom();
  };

  $("#updateStudyWhat").onclick=()=>{
    const data = getData();
    if(!data.room) return;
    data.room.what = $("#studyWhat").value.trim();
    saveData(data);
    renderRoom();
  };

  $("#startStudy").onclick=()=>{
    if(studyStartedAt) return;
    studyStartedAt = Date.now();
    $("#startStudy").textContent = "学习中…";
  };

  $("#stopStudy").onclick=()=>{
    if(!studyStartedAt) return;
    const mins = Math.max(1, Math.round((Date.now() - studyStartedAt)/60000));
    studyStartedAt = null;
    const data = getData();
    data.room.todayMinutes = (data.room.todayMinutes || 0) + mins;
    saveData(data);
    logEvent(`自习室：${data.room.what || "学习"}`, mins, "自习室");
    $("#startStudy").textContent = "开始学习";
    renderRoom();
  };
}
function renderRoom(){
  if(!currentUser || !cloudData) return;
  const data = getData();
  if(!data.room){
    $("#roomPanel").classList.add("hidden");
    return;
  }

  $("#roomPanel").classList.remove("hidden");
  $("#roomTitle").textContent = `${data.room.name} · 加入码 ${data.room.code}`;
  $("#studyWhat").value = data.room.what || "";

  const me = data.profile.name || "我";
  const seats = [{name:me, avatar:data.profile.avatar, what:data.room.what || "还没填写", minutes:data.room.todayMinutes || 0}];
  while(seats.length < 8) seats.push(null);

  $("#seatGrid").innerHTML = seats.map((s,i)=> s ? `
    <div class="seat">
      <strong>${escapeHtml(s.avatar)} ${escapeHtml(s.name)}</strong>
      <p class="hint">正在学：${escapeHtml(s.what)}</p>
      <p class="hint">今日：${s.minutes} 分钟</p>
    </div>
  ` : `<div class="seat"><p class="hint">空座位 ${i+1}</p></div>`).join("");

  $("#rankList").innerHTML = `<div class="item">
    <div class="item-top"><span>1. ${escapeHtml(me)}</span><strong>${data.room.todayMinutes || 0} 分钟</strong></div>
  </div>`;
}

function initProfile(){
  const icons = ["💧","🌷","☁️","🌙","⭐","📚","🎧","🧸","🐰","🦢","🕯️","🍓","🫧","🍵","🪻","🦋"];
  $("#iconPicker").innerHTML = icons.map(i=>`<button class="icon-option" data-icon="${i}">${i}</button>`).join("");

  $$(".icon-option").forEach(btn=>{
    btn.onclick=()=>{
      const data = getData();
      data.profile.avatar = btn.dataset.icon;
      saveData(data);
      renderProfile();
    };
  });

  $("#saveProfile").onclick=()=>{
    const data = getData();
    data.profile.name = $("#profileName").value.trim() || "朋友";
    data.profile.numberFont = $("#numberFont").value;
    saveData(data);
    applyProfile(data.profile);
    renderProfile();
  };
}
function renderProfile(){
  if(!currentUser || !cloudData) return;
  const data = getData();
  $("#avatarPreview").textContent = data.profile.avatar || "💧";
  $("#profileName").value = data.profile.name || "";
  $("#numberFont").value = data.profile.numberFont || "Quicksand";
  $$(".icon-option").forEach(btn=>btn.classList.toggle("active", btn.dataset.icon === data.profile.avatar));
}

function renderAll(){
  tickClock();
  renderTimer();
  renderTodos();
  renderCountdowns();
  renderCalendar();
  renderRoom();
  renderProfile();
}

initAuth();
initNav();
initAudio();
initPomodoro();
initTodos();
initCountdowns();
initCalendar();
initStudyRoom();
initProfile();

supabaseClient.auth.getSession().then(async ({ data })=>{
  if(data.session){
    try{
      await enterApp(data.session);
    }catch(err){
      console.error(err);
      $("#authMsg").textContent = "自动登录失败，请刷新页面";
    }
  }else{
    tickClock();
    renderTimer();
  }
});

supabaseClient.auth.onAuthStateChange(async (event, session)=>{
  if(event === "SIGNED_IN" && session){
    try{
      await enterApp(session);
    }catch(err){
      console.error(err);
      $("#authMsg").textContent = "登录成功，但读取数据失败";
    }
  }
});
const menuToggle = document.getElementById("menuToggle");
const mobileNav = document.querySelector(".nav");

if(menuToggle && mobileNav){

  menuToggle.addEventListener("click",()=>{

    mobileNav.classList.toggle("open");

  });

  document.querySelectorAll(".nav-btn").forEach(btn=>{

    btn.addEventListener("click",()=>{

      mobileNav.classList.remove("open");

    });

  });

}


/* =========================
   小水滴 v7：统计、报告、正向计时、待办关联、多用户自习室
   ========================= */

let v7TimerMode = "pomodoro";
let v7CountupSeconds = 0;
let v7CountupInterval = null;
let activeRoomCode = null;
let roomChannel = null;
let roomHeartbeat = null;

function v7FormatMinutes(min){
  min = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if(h && m) return `${h}小时${m}分钟`;
  if(h) return `${h}小时`;
  return `${m}分钟`;
}

function v7DateKey(date){
  return date.toISOString().slice(0,10);
}

function v7LogsInDays(days){
  const data = getData();
  const logs = [];
  const now = new Date();
  for(let i=0;i<days;i++){
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = v7DateKey(d);
    (data?.logs?.[key] || []).forEach(l=>logs.push({...l,date:key}));
  }
  return logs;
}

function v7SumMinutes(logs){
  return logs.reduce((s,l)=>s + (Number(l.minutes)||0),0);
}

function renderStats(){
  if(!cloudData) return;
  const data = getData();
  const todayLogs = data.logs?.[todayKey()] || [];
  const weekLogs = v7LogsInDays(7);
  const monthLogs = v7LogsInDays(30);

  const todayMin = v7SumMinutes(todayLogs);
  const weekMin = v7SumMinutes(weekLogs);
  const monthMin = v7SumMinutes(monthLogs);
  const doneTasks = (data.tasks || []).filter(t=>t.done).length;

  const statToday = document.getElementById("statToday");
  const statWeek = document.getElementById("statWeek");
  const statMonth = document.getElementById("statMonth");
  const statDoneTasks = document.getElementById("statDoneTasks");

  if(statToday) statToday.textContent = v7FormatMinutes(todayMin);
  if(statWeek) statWeek.textContent = v7FormatMinutes(weekMin);
  if(statMonth) statMonth.textContent = v7FormatMinutes(monthMin);
  if(statDoneTasks) statDoneTasks.textContent = `${doneTasks} 个`;

  const dailyReport = document.getElementById("dailyReport");
  if(dailyReport){
    if(todayMin){
      const items = todayLogs.filter(l=>l.minutes).map(l=>`- ${l.text}：${l.minutes}分钟`).join("\n");
      dailyReport.textContent = `今天一共学习了 ${v7FormatMinutes(todayMin)}。\n${items || "今天有学习记录。"}\n\n今天已经有在往前走了，不用一下子做到完美。`;
    }else{
      dailyReport.textContent = "今天还没有学习记录。可以先开一个番茄钟，或者进入自习室学习一会儿。";
    }
  }

  const weeklyReport = document.getElementById("weeklyReport");
  if(weeklyReport){
    if(weekMin){
      const dayMap = {};
      weekLogs.forEach(l=>dayMap[l.date]=(dayMap[l.date]||0)+(Number(l.minutes)||0));
      const best = Object.entries(dayMap).sort((a,b)=>b[1]-a[1])[0];
      weeklyReport.textContent = `本周累计学习 ${v7FormatMinutes(weekMin)}。\n${best ? `学习最多的一天是 ${best[0]}，共 ${v7FormatMinutes(best[1])}。` : ""}\n\n继续保持这个节奏就很好。`;
    }else{
      weeklyReport.textContent = "本周还没有学习记录。等你开始使用番茄钟或自习室后，这里会自动生成周报。";
    }
  }
}

function refreshPomodoroTaskOptions(){
  const select = document.getElementById("pomodoroTaskSelect");
  if(!select || !cloudData) return;
  const old = select.value;
  const tasks = (getData().tasks || []).filter(t=>!t.done);
  select.innerHTML = `<option value="">不关联待办</option>` + tasks.map(t=>`<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)}</option>`).join("");
  if(old) select.value = old;
}

function applyPomodoroTask(){
  const select = document.getElementById("pomodoroTaskSelect");
  const input = document.getElementById("focusProject");
  if(!select || !input || !cloudData) return;
  const task = (getData().tasks || []).find(t=>t.id === select.value);
  if(task) input.value = task.title;
}

function setV7TimerMode(mode){
  v7TimerMode = mode;
  document.getElementById("modePomodoro")?.classList.toggle("active", mode==="pomodoro");
  document.getElementById("modeCountup")?.classList.toggle("active", mode==="countup");
  clearInterval(timer);
  clearInterval(v7CountupInterval);
  timerRunning = false;

  if(mode === "countup"){
    v7CountupSeconds = 0;
    document.getElementById("timerDisplay").textContent = "00:00";
    document.getElementById("timerStatus").textContent = "正向计时准备开始";
    document.getElementById("timerRing")?.style.setProperty("--progress","0deg");
  }else{
    timerTotal = Number(document.getElementById("focusMinutes")?.value || 25) * 60;
    timerLeft = timerTotal;
    document.getElementById("timerStatus").textContent = "准备开始";
    renderTimer();
  }
}

function finishFocusSession(minutes){
  const data = getData();
  const project = document.getElementById("focusProject")?.value.trim() || "未命名专注";
  const taskId = document.getElementById("pomodoroTaskSelect")?.value || "";

  logEvent(`番茄钟：${project}`, minutes, "专注");

  if(taskId){
    const task = (data.tasks || []).find(t=>t.id === taskId);
    if(task){
      task.progress = Math.min(100, Number(task.progress || 0) + Math.max(10, Math.round(minutes / 25 * 25)));
      if(task.progress >= 100){
        task.done = true;
        logEvent(`完成任务：${task.title}`, 0, "任务");
      }
      saveData(data);
      renderTodos();
      refreshPomodoroTaskOptions();
    }
  }

  renderStats();
}

function startV7Timer(){
  if(timerRunning) return;
  timerRunning = true;

  if(v7TimerMode === "countup"){
    document.getElementById("timerStatus").textContent = "正向计时中";
    v7CountupInterval = setInterval(()=>{
      v7CountupSeconds++;
      const m = String(Math.floor(v7CountupSeconds/60)).padStart(2,"0");
      const s = String(v7CountupSeconds%60).padStart(2,"0");
      document.getElementById("timerDisplay").textContent = `${m}:${s}`;
      const base = Number(document.getElementById("focusMinutes")?.value || 25) * 60;
      const deg = Math.min(360, v7CountupSeconds / base * 360);
      document.getElementById("timerRing")?.style.setProperty("--progress", `${deg}deg`);
    },1000);
    return;
  }

  document.getElementById("timerStatus").textContent = "专注中";
  timer = setInterval(()=>{
    timerLeft--;
    renderTimer();
    if(timerLeft <= 0){
      clearInterval(timer);
      timerRunning = false;
      const mins = Number(document.getElementById("focusMinutes")?.value || 25);
      finishFocusSession(mins);
      document.getElementById("timerStatus").textContent = "已完成";
      timerTotal = Number(document.getElementById("breakMinutes")?.value || 5) * 60;
      timerLeft = timerTotal;
      renderTimer();
    }
  },1000);
}

function pauseV7Timer(){
  clearInterval(timer);
  clearInterval(v7CountupInterval);
  timerRunning = false;
  document.getElementById("timerStatus").textContent = "已暂停";
}

function resetV7Timer(){
  if(v7TimerMode === "countup" && v7CountupSeconds > 0){
    const minutes = Math.max(1, Math.round(v7CountupSeconds / 60));
    finishFocusSession(minutes);
    document.getElementById("timerStatus").textContent = `已保存 ${minutes} 分钟`;
  }
  setV7TimerMode(v7TimerMode);
}

function setupV7Pomodoro(){
  document.getElementById("modePomodoro")?.addEventListener("click",()=>setV7TimerMode("pomodoro"));
  document.getElementById("modeCountup")?.addEventListener("click",()=>setV7TimerMode("countup"));
  document.getElementById("pomodoroTaskSelect")?.addEventListener("change", applyPomodoroTask);

  const start = document.getElementById("startTimer");
  const pause = document.getElementById("pauseTimer");
  const reset = document.getElementById("resetTimer");

  if(start) start.onclick = startV7Timer;
  if(pause) pause.onclick = pauseV7Timer;
  if(reset) reset.onclick = resetV7Timer;

  refreshPomodoroTaskOptions();
}

async function joinRealtimeRoom(){
  if(!currentSession?.user) return;

  const data = getData();
  const name = document.getElementById("roomName")?.value.trim() || "小水滴自习室";
  const code = document.getElementById("roomCode")?.value.trim() || "0000";
  const profile = data.profile || {};
  activeRoomCode = code;

  await supabaseClient.from("study_rooms").upsert({
    room_code: code,
    room_name: name,
    created_by: currentSession.user.id
  });

  await supabaseClient.from("room_participants").upsert({
    room_code: code,
    user_id: currentSession.user.id,
    display_name: profile.name || currentSession.user.email || "朋友",
    avatar: profile.avatar || "💧",
    study_what: document.getElementById("studyWhat")?.value.trim() || "",
    is_studying: false,
    total_seconds: 0,
    today_key: todayKey(),
    last_seen: new Date().toISOString()
  });

  data.room = {name, code, what:data.room?.what || "", todayMinutes:data.room?.todayMinutes || 0};
  saveData(data);

  document.getElementById("roomPanel")?.classList.remove("hidden");
  document.getElementById("roomTitle").textContent = `${name} · 加入码 ${code}`;

  subscribeRoom(code);
  await loadRoomParticipants();

  clearInterval(roomHeartbeat);
  roomHeartbeat = setInterval(updateRoomHeartbeat, 15000);
}

async function updateRoomHeartbeat(){
  if(!activeRoomCode || !currentSession?.user) return;
  await supabaseClient.from("room_participants")
    .update({last_seen:new Date().toISOString()})
    .eq("room_code", activeRoomCode)
    .eq("user_id", currentSession.user.id);
}

function subscribeRoom(code){
  if(roomChannel) supabaseClient.removeChannel(roomChannel);
  roomChannel = supabaseClient
    .channel(`room:${code}`)
    .on("postgres_changes", {
      event:"*",
      schema:"public",
      table:"room_participants",
      filter:`room_code=eq.${code}`
    }, () => loadRoomParticipants())
    .subscribe();
}

async function loadRoomParticipants(){
  if(!activeRoomCode) return;
  const { data, error } = await supabaseClient
    .from("room_participants")
    .select("*")
    .eq("room_code", activeRoomCode)
    .order("total_seconds", {ascending:false});

  if(error){
    console.error("读取自习室失败", error);
    return;
  }

  renderRealtimeRoom(data || []);
}

function secondsWithLive(p){
  let total = Number(p.total_seconds || 0);
  if(p.is_studying && p.started_at){
    total += Math.max(0, Math.floor((Date.now() - new Date(p.started_at).getTime())/1000));
  }
  return total;
}

function renderRealtimeRoom(participants){
  const now = Date.now();
  const online = participants.filter(p => now - new Date(p.last_seen).getTime() < 45000);
  const seats = online.slice(0,8);
  while(seats.length < 8) seats.push(null);

  const seatGrid = document.getElementById("seatGrid");
  if(seatGrid){
    seatGrid.innerHTML = seats.map((p,i)=>{
      if(!p) return `<div class="seat"><p class="hint">空座位 ${i+1}</p></div>`;
      const minutes = Math.floor(secondsWithLive(p)/60);
      return `<div class="seat ${p.is_studying ? "active-study" : ""}">
        <strong>${escapeHtml(p.avatar || "💧")} ${escapeHtml(p.display_name || "朋友")}</strong>
        <p class="hint"><span class="room-status-dot"></span>${p.is_studying ? "学习中" : "在线"}</p>
        <p class="hint">正在学：${escapeHtml(p.study_what || "还没填写")}</p>
        <p class="hint">今日：${v7FormatMinutes(minutes)}</p>
      </div>`;
    }).join("");
  }

  const rankList = document.getElementById("rankList");
  if(rankList){
    const ranked = [...online].sort((a,b)=>secondsWithLive(b)-secondsWithLive(a));
    rankList.innerHTML = ranked.map((p,i)=>`
      <div class="item">
        <div class="item-top">
          <span>${i+1}. ${escapeHtml(p.avatar || "💧")} ${escapeHtml(p.display_name || "朋友")}</span>
          <strong>${v7FormatMinutes(Math.floor(secondsWithLive(p)/60))}</strong>
        </div>
      </div>
    `).join("") || `<p class="hint">暂时还没有人在房间里。</p>`;
  }
}

async function updateStudyWhatRealtime(){
  if(!activeRoomCode || !currentSession?.user) return;
  const what = document.getElementById("studyWhat")?.value.trim() || "";
  const data = getData();
  if(data.room) data.room.what = what;
  saveData(data);

  await supabaseClient.from("room_participants")
    .update({study_what:what, last_seen:new Date().toISOString()})
    .eq("room_code", activeRoomCode)
    .eq("user_id", currentSession.user.id);
}

async function startRealtimeStudy(){
  if(!activeRoomCode || !currentSession?.user) return;
  const what = document.getElementById("studyWhat")?.value.trim() || "";
  await supabaseClient.from("room_participants")
    .update({
      is_studying:true,
      study_what:what,
      started_at:new Date().toISOString(),
      last_seen:new Date().toISOString()
    })
    .eq("room_code", activeRoomCode)
    .eq("user_id", currentSession.user.id);

  document.getElementById("startStudy").textContent = "学习中…";
  await loadRoomParticipants();
}

async function stopRealtimeStudy(){
  if(!activeRoomCode || !currentSession?.user) return;

  const { data: rows } = await supabaseClient.from("room_participants")
    .select("started_at,total_seconds,study_what")
    .eq("room_code", activeRoomCode)
    .eq("user_id", currentSession.user.id)
    .limit(1);

  const row = rows?.[0];
  let add = 0;
  if(row?.started_at){
    add = Math.max(0, Math.floor((Date.now() - new Date(row.started_at).getTime())/1000));
  }

  const newTotal = Number(row?.total_seconds || 0) + add;
  const minutes = Math.max(1, Math.round(add/60));

  await supabaseClient.from("room_participants")
    .update({
      is_studying:false,
      started_at:null,
      total_seconds:newTotal,
      last_seen:new Date().toISOString()
    })
    .eq("room_code", activeRoomCode)
    .eq("user_id", currentSession.user.id);

  if(add > 0){
    logEvent(`自习室：${row?.study_what || "学习"}`, minutes, "自习室");
  }

  document.getElementById("startStudy").textContent = "开始学习";
  await loadRoomParticipants();
  renderStats();
}

function setupRealtimeStudyRoom(){
  const joinBtn = document.getElementById("joinRoom");
  const updateBtn = document.getElementById("updateStudyWhat");
  const startBtn = document.getElementById("startStudy");
  const stopBtn = document.getElementById("stopStudy");

  if(joinBtn) joinBtn.onclick = joinRealtimeRoom;
  if(updateBtn) updateBtn.onclick = updateStudyWhatRealtime;
  if(startBtn) startBtn.onclick = startRealtimeStudy;
  if(stopBtn) stopBtn.onclick = stopRealtimeStudy;
}

function setupV7NavHooks(){
  document.querySelectorAll(".nav-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelector(".nav")?.classList.remove("open");
      if(btn.dataset.page === "stats") renderStats();
      if(btn.dataset.page === "pomodoro") refreshPomodoroTaskOptions();
    });
  });
}

const oldRenderAllV7 = renderAll;
renderAll = function(){
  oldRenderAllV7();
  refreshPomodoroTaskOptions();
  renderStats();
};

const oldRenderTodosV7 = renderTodos;
renderTodos = function(){
  oldRenderTodosV7();
  refreshPomodoroTaskOptions();
};

setupV7Pomodoro();
setupRealtimeStudyRoom();
setupV7NavHooks();

window.addEventListener("beforeunload", async ()=>{
  if(activeRoomCode && currentSession?.user){
    await supabaseClient.from("room_participants")
      .update({is_studying:false, started_at:null, last_seen:new Date().toISOString()})
      .eq("room_code", activeRoomCode)
      .eq("user_id", currentSession.user.id);
  }
});
