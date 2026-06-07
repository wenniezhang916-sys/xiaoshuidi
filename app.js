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
