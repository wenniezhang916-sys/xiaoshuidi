const SUPABASE_URL = "https://huyifomichrbcvxxwmtm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1eWlmb21pY2hyYmN2eHh3bXRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3OTUxMjMsImV4cCI6MjA5NjM3MTEyM30.TZRAA5I-0zj3-N_Thof5sGCBCzGs1IkqjXtxzVinyHI";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage
  }
});

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

let authMode = "login";
let currentUser = null;
let currentSession = null;
let cloudData = null;
let manualLogout = false;

let timer = null;
let timerMode = "pomodoro";
let timerRunning = false;
let timerStartedAt = null;
let timerPausedSeconds = 0;
let timerLeft = 25 * 60;
let timerTotal = 25 * 60;

let audioCtx = null;
let currentSoundNodes = [];
let saveTimer = null;
let activeRoomCode = null;
let roomChannel = null;
let roomHeartbeat = null;

const PIE_COLORS = ["#c8b7a4","#b9c7b3","#d6b6ad","#b8bfd3","#d7c8a8","#a9c7c3","#c5adc9","#d3bca2"];

const todayKey = () => new Date().toISOString().slice(0,10);
const uid = () => Math.random().toString(36).slice(2,10);

// ── 页面持久化 ──────────────────────────────────────────────
function saveCurrentPage(pageId){
  try{ localStorage.setItem("xiaoshuidi-page", pageId); }catch(e){}
}
function restorePage(){
  try{
    const saved = localStorage.getItem("xiaoshuidi-page");
    if(!saved) return;
    const btn = document.querySelector(`.nav-btn[data-page="${saved}"]`);
    const page = document.getElementById(saved);
    if(btn && page){
      document.querySelectorAll(".nav-btn").forEach(b=>b.classList.remove("active"));
      document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
      btn.classList.add("active");
      page.classList.add("active");
    }
  }catch(e){}
}

// ── 计时器持久化 ────────────────────────────────────────────
function saveTimerState(){
  try{
    const state = {
      timerMode,
      timerRunning,
      timerLeft,
      timerTotal,
      timerPausedSeconds,
      timerStartedAt: timerRunning ? timerStartedAt : null,
      focusProject: document.getElementById("focusProject")?.value || "",
      focusMinutes: document.getElementById("focusMinutes")?.value || "25",
      breakMinutes: document.getElementById("breakMinutes")?.value || "5",
    };
    localStorage.setItem("xiaoshuidi-timer", JSON.stringify(state));
  }catch(e){}
}
function restoreTimerState(){
  try{
    const raw = localStorage.getItem("xiaoshuidi-timer");
    if(!raw) return;
    const s = JSON.parse(raw);
    timerMode = s.timerMode || "pomodoro";
    timerTotal = Number(s.timerTotal) || 25*60;
    timerPausedSeconds = Number(s.timerPausedSeconds) || 0;

    // 如果刷新前正在计时，根据经过的时间推算剩余
    if(s.timerRunning && s.timerStartedAt){
      const elapsed = Math.floor((Date.now() - s.timerStartedAt) / 1000);
      if(s.timerMode === "countup"){
        timerPausedSeconds = s.timerPausedSeconds + elapsed;
        timerLeft = timerTotal;
      }else{
        timerLeft = Math.max(0, s.timerLeft - elapsed);
      }
    }else{
      timerLeft = Number(s.timerLeft) || timerTotal;
    }

    const fpEl = document.getElementById("focusProject");
    const fmEl = document.getElementById("focusMinutes");
    const bmEl = document.getElementById("breakMinutes");
    if(fpEl && s.focusProject) fpEl.value = s.focusProject;
    if(fmEl && s.focusMinutes) fmEl.value = s.focusMinutes;
    if(bmEl && s.breakMinutes) bmEl.value = s.breakMinutes;

    // 模式按钮状态
    const mp = document.getElementById("modePomodoro");
    const mc = document.getElementById("modeCountup");
    if(mp) mp.classList.toggle("active", timerMode === "pomodoro");
    if(mc) mc.classList.toggle("active", timerMode === "countup");

    // 如果刷新前正在跑，恢复计时
    if(s.timerRunning){
      timerRunning = false; // startTimerSession 会置为 true
      startTimerSession();
      const statusEl = document.getElementById("timerStatus");
      if(statusEl) statusEl.textContent = timerMode === "countup" ? "正向计时中（已恢复）" : "专注中（已恢复）";
    }else{
      renderTimer();
    }
  }catch(e){ console.warn("计时器恢复失败", e); }
}

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
    archived:[],
    room:null
  };
}

function normalizeItem(item, type){
  return {
    id:item.id || uid(),
    title:item.title || "未命名",
    type,
    count:Number(item.count || 0),
    done:Boolean(item.done || false),
    archived:Boolean(item.archived || false),
    archivedAt:item.archivedAt || null,
    createdAt:item.createdAt || new Date().toISOString(),
    goalType:item.goalType || (type === "task" ? "manual" : "none"),
    goalMinutes:Number(item.goalMinutes || 0),
    goalDays:Number(item.goalDays || 0),
    accumulatedMinutes:Number(item.accumulatedMinutes || 0),
    accumulatedDays:Number(item.accumulatedDays || item.count || 0),
    progress:Number(item.progress || 0)
  };
}

function normalizeData(raw, email){
  const base = defaultData(email);
  const data = {...base, ...(raw || {})};
  data.profile = {...base.profile, ...(data.profile || {})};
  data.daily = Array.isArray(data.daily) ? data.daily.map(i=>normalizeItem(i,"daily")).filter(i=>!i.archived) : [];
  data.tasks = Array.isArray(data.tasks) ? data.tasks.map(i=>normalizeItem(i,"task")).filter(i=>!i.archived) : [];
  data.archived = Array.isArray(data.archived) ? data.archived.map(i=>normalizeItem(i,i.type || "task")) : [];
  data.countdowns = Array.isArray(data.countdowns) ? data.countdowns : [];
  data.logs = data.logs || {};
  data.notes = data.notes || {};
  return data;
}


function getLocalBackup(session){
  try{
    const key = session?.user?.id ? `xiaoshuidi-backup-${session.user.id}` : "xiaoshuidi-backup";
    const raw = localStorage.getItem(key);
    if(raw) return normalizeData(JSON.parse(raw), session?.user?.email);
  }catch(e){}
  return null;
}

function saveLocalBackup(session, data){
  try{
    const key = session?.user?.id ? `xiaoshuidi-backup-${session.user.id}` : "xiaoshuidi-backup";
    localStorage.setItem(key, JSON.stringify(data));
  }catch(e){}
}

function getData(){ return cloudData; }

function saveData(data){
  cloudData = data;
  try{
    const key = currentSession?.user?.id ? `xiaoshuidi-backup-${currentSession.user.id}` : "xiaoshuidi-backup";
    localStorage.setItem(key, JSON.stringify(data));
  }catch(e){}
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCloudData, 300);
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
  try{
    const { data, error } = await supabaseClient
      .from("app_data")
      .select("data")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if(error) throw error;

    if(data?.data){
      cloudData = normalizeData(data.data, session.user.email);
      saveLocalBackup(session, cloudData);
    }else{
      const backup = getLocalBackup(session);
      cloudData = backup || defaultData(session.user.email);

      const { error: insertError } = await supabaseClient
        .from("app_data")
        .upsert({ user_id: session.user.id, data: cloudData, updated_at: new Date().toISOString() });

      if(insertError) console.warn("云端初始化失败，先用本地数据进入：", insertError);
      saveLocalBackup(session, cloudData);
    }
  }catch(err){
    console.warn("云端读取失败，先用本地缓存进入：", err);
    cloudData = getLocalBackup(session) || defaultData(session.user.email);
    saveLocalBackup(session, cloudData);
  }
}

function formatMinutes(min){
  min = Math.max(0, Math.round(Number(min)||0));
  const h = Math.floor(min/60), m = min%60;
  if(h && m) return `${h}小时${m}分钟`;
  if(h) return `${h}小时`;
  return `${m}分钟`;
}

function goalPercent(item){
  if(item.goalType === "none") return null;
  if(item.goalType === "manual") return Math.min(100, Math.max(0, Number(item.progress || 0)));
  if(item.goalType === "time") {
    if(!item.goalMinutes) return 0;
    return Math.min(100, Math.max(0, item.accumulatedMinutes / item.goalMinutes * 100));
  }
  if(item.goalType === "days") {
    if(!item.goalDays) return 0;
    return Math.min(100, Math.max(0, item.accumulatedDays / item.goalDays * 100));
  }
  return 0;
}

function itemMeta(item){
  const parts = [];
  if(item.goalType === "time") parts.push(`累计 ${formatMinutes(item.accumulatedMinutes)} / 目标 ${formatMinutes(item.goalMinutes)}`);
  if(item.goalType === "days") parts.push(`累计 ${item.accumulatedDays} 天 / 目标 ${item.goalDays} 天`);
  if(item.goalType === "manual") parts.push(`手动进度 ${Math.round(item.progress || 0)}%`);
  if(item.goalType === "none") parts.push("不显示百分比");
  if(item.count) parts.push(`打卡 ${item.count} 次`);
  return parts.join(" · ");
}

function logEvent(text, minutes=0, type="记录", extra={}){
  const data = getData();
  const day = todayKey();
  if(!data.logs[day]) data.logs[day] = [];
  data.logs[day].push({
    id:uid(),
    text,
    minutes:Math.round(Number(minutes)||0),
    type,
    time:new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}),
    createdAt:new Date().toISOString(),
    ...extra
  });
  saveData(data);
  renderCalendar();
  renderStats();
}

function setAuthLoading(isLoading, text="正在处理…"){
  const btn = $("#authBtn");
  if(btn){
    btn.disabled = isLoading;
    btn.textContent = isLoading ? text : (authMode === "login" ? "进入小水滴" : "注册并进入");
  }
  if(isLoading) $("#authMsg").textContent = text;
}

function showAuthError(message){
  setAuthLoading(false);
  $("#authMsg").textContent = message || "登录失败，请刷新后重试。";
}

function withTimeout(promise, ms=15000, label="请求超时，请刷新后重试。"){
  let timeout;
  const timer = new Promise((_, reject)=>timeout=setTimeout(()=>reject(new Error(label)), ms));
  return Promise.race([promise, timer]).finally(()=>clearTimeout(timeout));
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
        options:{ redirectTo: window.location.origin + window.location.pathname }
      });
      if(error) showAuthError(error.message);
    };
  });

  $("#authBtn").onclick=async()=>{
    const email = $("#authId").value.trim();
    const password = $("#authPwd").value.trim();
    if(!email || !password) return $("#authMsg").textContent = "邮箱和密码都要填。";
    setAuthLoading(true);
    try{
      let result;
      if(authMode === "register"){
        result = await withTimeout(supabaseClient.auth.signUp({ email, password }));
        if(result.error) return showAuthError(result.error.message);
        if(!result.data.session){
          authMode = "login";
          $$(".tab").forEach(b=>b.classList.toggle("active", b.dataset.auth === "login"));
          setAuthLoading(false);
          $("#authMsg").textContent = "注册成功。请切到登录进入。";
          return;
        }
      }else{
        result = await withTimeout(supabaseClient.auth.signInWithPassword({ email, password }));
        if(result.error) return showAuthError(result.error.message);
      }
      if(!result?.data?.session) return showAuthError("没有拿到登录状态，请刷新后重试。");
      await enterApp(result.data.session);
    }catch(err){
      showAuthError(err.message);
    }
  };
}

async function enterApp(session){
  if(!session?.user) return showAuthError("登录状态无效，请重新登录。");
  currentSession = session;
  currentUser = session.user.email || session.user.id;
  $("#authMsg").textContent = "正在读取数据…";
  await loadCloudData(session);
  $("#authPage").classList.add("hidden");
  $("#mainPage").classList.remove("hidden");
  applyProfile(getData().profile);
  renderAll();
  setAuthLoading(false);
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
      saveCurrentPage(btn.dataset.page);
      $(".nav")?.classList.remove("open");
      if(btn.dataset.page === "calendar") renderCalendar();
      if(btn.dataset.page === "stats") renderStats();
      if(btn.dataset.page === "pomodoro") refreshPomodoroTaskOptions();
      if(btn.dataset.page === "history") renderHistory();
    };
  });

  $("#menuToggle").onclick=()=>$(".nav")?.classList.toggle("open");

  $("#themeToggle").onclick=()=>{
    const data = getData();
    data.profile.theme = data.profile.theme === "dark" ? "light" : "dark";
    saveData(data);
    applyProfile(data.profile);
  };

  $("#logoutBtn").onclick=async()=>{
    manualLogout = true;
    localStorage.setItem("xiaoshuidi-manual-logout", "1");
    await saveCloudData();
    await supabaseClient.auth.signOut();
    currentSession = null;
    location.reload();
  };
}

function tickClock(){
  const now = new Date();
  $("#clockTime").textContent = now.toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
  $("#clockDate").textContent = now.toLocaleDateString("zh-CN",{year:"numeric",month:"long",day:"numeric",weekday:"long"});
  const lines = ["慢慢来，也是在向前走。","完成一点点，也值得开心。","今天已经很努力了。","不用急，你有自己的节奏。","喝口水，休息一下，再继续。"];
  $("#warmText").textContent = lines[now.getDate() % lines.length];
}
setInterval(tickClock, 1000);

function getGoal(prefix){
  const type = $(`#${prefix}GoalType`).value;
  const h = Number($(`#${prefix}GoalHours`).value || 0);
  const m = Number($(`#${prefix}GoalMinutes`).value || 0);
  const d = Number($(`#${prefix}GoalDays`).value || 0);
  return { goalType:type, goalMinutes:h*60+m, goalDays:d };
}

function initTodos(){
  $("#addDaily").onclick=()=>{
    const title = $("#dailyInput").value.trim();
    if(!title) return;
    const data = getData();
    data.daily.push(normalizeItem({id:uid(), title, ...getGoal("daily")}, "daily"));
    $("#dailyInput").value="";
    saveData(data); renderTodos(); refreshPomodoroTaskOptions();
  };

  $("#addTask").onclick=()=>{
    const title = $("#taskInput").value.trim();
    if(!title) return;
    const data = getData();
    data.tasks.push(normalizeItem({id:uid(), title, ...getGoal("task")}, "task"));
    $("#taskInput").value="";
    saveData(data); renderTodos(); refreshPomodoroTaskOptions();
  };
}

function progressHtml(item){
  const p = goalPercent(item);
  if(p === null) return "";
  const pct = Math.min(100, Math.max(0, p));
  const bar = `<div class="progress"><span style="width:${pct}%"></span></div>`;
  if(item.goalType === "manual") {
    return `${bar}<input class="manual-range" type="range" min="0" max="100" value="${pct}" oninput="setItemManualProgress('${item.type}','${item.id}',this.value)">`;
  }
  return bar;
}

function itemButtons(item){
  const doneLabel = item.done ? "已完成" : "完成";
  return `
    <button class="mini soft-btn" onclick="completeItem('${item.type}','${item.id}')">${doneLabel}</button>
    <button class="mini soft-btn" onclick="archiveItem('${item.type}','${item.id}')">归档</button>
    <button class="mini soft-btn" onclick="deleteItem('${item.type}','${item.id}')">删除</button>
  `;
}

function renderTodos(){
  const data = getData();
  $("#dailyList").innerHTML = (data.daily||[]).map(d=>`
    <div class="item">
      <div class="item-top">
        <span class="item-title">${d.done ? "✅" : "○"} ${escapeHtml(d.title)}</span>
        <div class="item-actions">
          <button class="mini soft-btn" onclick="checkDaily('${d.id}')">打卡</button>
          ${itemButtons(d)}
        </div>
      </div>
      <div class="meta-line">${itemMeta(d)}</div>
      ${progressHtml(d)}
    </div>
  `).join("") || `<p class="hint">还没有 Daily。</p>`;

  $("#taskList").innerHTML = (data.tasks||[]).map(t=>`
    <div class="item">
      <div class="item-top">
        <span class="item-title">${t.done ? "✅" : "○"} ${escapeHtml(t.title)}</span>
        <div class="item-actions">${itemButtons(t)}</div>
      </div>
      <div class="meta-line">${itemMeta(t)}</div>
      ${progressHtml(t)}
    </div>
  `).join("") || `<p class="hint">还没有普通任务。</p>`;
  refreshPomodoroTaskOptions();
}

window.checkDaily = id=>{
  const data=getData();
  const d=data.daily.find(x=>x.id===id);
  if(!d) return;
  d.count=(d.count||0)+1;
  d.accumulatedDays=(d.accumulatedDays||0)+1;
  if(goalPercent(d) >= 100) d.done = true;
  logEvent(`Daily 打卡：${d.title}`,0,"Daily",{itemId:d.id,itemTitle:d.title,itemType:"daily"});
  saveData(data); renderTodos(); renderStats();
};

window.setItemManualProgress = (type,id,val)=>{
  const data=getData();
  const list= type==="daily" ? data.daily : data.tasks;
  const item=list.find(x=>x.id===id);
  if(!item) return;
  item.progress=Number(val);
  if(item.progress>=100) item.done=true;
  saveData(data); renderTodos(); renderStats();
};

window.completeItem = (type,id)=>{
  const data=getData();
  const list= type==="daily" ? data.daily : data.tasks;
  const item=list.find(x=>x.id===id);
  if(!item) return;
  item.done=true;
  if(item.goalType==="manual") item.progress=100;
  saveData(data); renderTodos(); renderStats();
};

window.archiveItem = (type,id)=>{
  const data=getData();
  const list= type==="daily" ? data.daily : data.tasks;
  const idx=list.findIndex(x=>x.id===id);
  if(idx<0) return;
  const item=list.splice(idx,1)[0];
  item.archived=true; item.done=true; item.archivedAt=new Date().toISOString();
  data.archived = data.archived || [];
  data.archived.push(item);
  saveData(data); renderTodos(); renderHistory(); refreshPomodoroTaskOptions();
};

window.deleteItem = (type,id)=>{
  const data=getData();
  if(type==="daily") data.daily=data.daily.filter(x=>x.id!==id);
  else data.tasks=data.tasks.filter(x=>x.id!==id);
  saveData(data); renderTodos(); refreshPomodoroTaskOptions();
};

function refreshPomodoroTaskOptions(){
  const select=$("#pomodoroTaskSelect");
  if(!select || !cloudData) return;
  const old=select.value;
  const data=getData();
  const options = [
    ...(data.daily||[]).filter(i=>!i.done).map(i=>`daily:${i.id}|Daily｜${i.title}`),
    ...(data.tasks||[]).filter(i=>!i.done).map(i=>`task:${i.id}|任务｜${i.title}`)
  ];
  select.innerHTML = `<option value="">不关联待办</option>` + options.map(raw=>{
    const [val,label]=raw.split("|");
    return `<option value="${escapeHtml(val)}">${escapeHtml(label)}</option>`;
  }).join("");
  if(old) select.value=old;
}

function getSelectedLinkedItem(){
  const val=$("#pomodoroTaskSelect")?.value;
  if(!val) return null;
  const [type,id]=val.split(":");
  const data=getData();
  const list= type==="daily" ? data.daily : data.tasks;
  const item=list.find(x=>x.id===id);
  return item ? {type,id,item} : null;
}

$("#pomodoroTaskSelect")?.addEventListener("change",()=>{
  const linked=getSelectedLinkedItem();
  if(linked) $("#focusProject").value=linked.item.title;
});

function setTimerMode(mode){
  timerMode=mode;
  $("#modePomodoro").classList.toggle("active",mode==="pomodoro");
  $("#modeCountup").classList.toggle("active",mode==="countup");
  finishTimer(false);
  timerPausedSeconds=0;
  timerRunning=false;
  if(mode==="countup"){
    $("#timerDisplay").textContent="00:00";
    $("#timerStatus").textContent="正向计时准备开始";
    $("#timerRing").style.setProperty("--progress","0deg");
  }else{
    timerTotal=Number($("#focusMinutes").value||25)*60;
    timerLeft=timerTotal;
    renderTimer();
    $("#timerStatus").textContent="准备开始";
  }
}

$("#modePomodoro")?.addEventListener("click",()=>setTimerMode("pomodoro"));
$("#modeCountup")?.addEventListener("click",()=>setTimerMode("countup"));

function startTimerSession(){
  if(timerRunning) return;
  timerRunning=true;
  timerStartedAt=Date.now();
  if(timerMode==="countup"){
    $("#timerStatus").textContent="正向计时中";
    timer=setInterval(()=>{
      const sec=timerPausedSeconds + Math.floor((Date.now()-timerStartedAt)/1000);
      const m=String(Math.floor(sec/60)).padStart(2,"0");
      const s=String(sec%60).padStart(2,"0");
      $("#timerDisplay").textContent=`${m}:${s}`;
      const base=Number($("#focusMinutes").value||25)*60;
      $("#timerRing").style.setProperty("--progress",`${Math.min(360,sec/base*360)}deg`);
      saveTimerState();
    },1000);
  }else{
    $("#timerStatus").textContent="专注中";
    timer=setInterval(()=>{
      timerLeft--;
      renderTimer();
      saveTimerState();
      if(timerLeft<=0) finishTimer(true);
    },1000);
  }
}

function pauseTimerSession(){
  if(!timerRunning) return;
  if(timerMode==="countup") timerPausedSeconds += Math.floor((Date.now()-timerStartedAt)/1000);
  clearInterval(timer);
  timerRunning=false;
  $("#timerStatus").textContent="已暂停";
  saveTimerState();
}

function currentSessionMinutes(){
  if(timerMode==="countup"){
    const sec = timerPausedSeconds + (timerRunning ? Math.floor((Date.now()-timerStartedAt)/1000) : 0);
    return Math.max(1, Math.round(sec/60));
  }
  const total = Number($("#focusMinutes").value||25);
  const used = Math.max(0, Math.round((timerTotal - timerLeft)/60));
  return Math.max(1, used || total);
}

function finishTimer(record){
  clearInterval(timer);
  if(!timerRunning && !record) return;
  const minutes=currentSessionMinutes();
  timerRunning=false;
  timerPausedSeconds=0;
  try{ localStorage.removeItem("xiaoshuidi-timer"); }catch(e){}
  if(record) recordFocus(minutes);
  if(timerMode==="countup"){
    $("#timerDisplay").textContent="00:00";
    $("#timerRing").style.setProperty("--progress","0deg");
  }else{
    timerTotal=Number($("#focusMinutes").value||25)*60;
    timerLeft=timerTotal;
    renderTimer();
  }
  $("#timerStatus").textContent = record ? `已记录 ${minutes} 分钟` : "本次未计入";
}

function recordFocus(minutes){
  const data=getData();
  const linked=getSelectedLinkedItem();
  const project=$("#focusProject").value.trim() || linked?.item?.title || "未命名专注";
  const extra = linked ? {itemId:linked.id,itemTitle:linked.item.title,itemType:linked.type} : {itemTitle:project,itemType:"custom"};
  logEvent(`专注：${project}`, minutes, "专注", extra);

  if(linked){
    linked.item.accumulatedMinutes = Number(linked.item.accumulatedMinutes||0) + minutes;
    if(linked.item.goalType==="time" && goalPercent(linked.item)>=100) linked.item.done=true;
    saveData(data);
  }
  renderTodos(); renderStats(); refreshPomodoroTaskOptions();
}

$("#startTimer").onclick=startTimerSession;
$("#pauseTimer").onclick=pauseTimerSession;
$("#finishRecordTimer").onclick=()=>finishTimer(true);
$("#finishDiscardTimer").onclick=()=>finishTimer(false);

function renderTimer(){
  const m=String(Math.floor(timerLeft/60)).padStart(2,"0");
  const s=String(timerLeft%60).padStart(2,"0");
  $("#timerDisplay").textContent=`${m}:${s}`;
  const done=timerTotal ? (1-timerLeft/timerTotal) : 0;
  $("#timerRing").style.setProperty("--progress",`${Math.max(0,Math.min(1,done))*360}deg`);
}

function logsInDays(days){
  const data=getData(), res=[], now=new Date();
  for(let i=0;i<days;i++){ const d=new Date(now); d.setDate(now.getDate()-i); const key=d.toISOString().slice(0,10); (data.logs[key]||[]).forEach(l=>res.push({...l,date:key})); }
  return res;
}
function sumMinutes(logs){ return logs.reduce((s,l)=>s+(Number(l.minutes)||0),0); }

function renderStats(){
  if(!cloudData) return;
  const data=getData();
  const todayLogs=data.logs[todayKey()]||[], weekLogs=logsInDays(7), monthLogs=logsInDays(30);
  $("#statToday").textContent=formatMinutes(sumMinutes(todayLogs));
  $("#statWeek").textContent=formatMinutes(sumMinutes(weekLogs));
  $("#statMonth").textContent=formatMinutes(sumMinutes(monthLogs));
  $("#statDoneTasks").textContent=`${[...data.daily,...data.tasks].filter(i=>i.done).length} 个`;

  const map={};
  monthLogs.filter(l=>l.minutes).forEach(l=>{ const k=l.itemTitle||l.text||"其他"; map[k]=(map[k]||0)+Number(l.minutes); });
  renderPie(map);

  $("#dailyReport").textContent = todayLogs.length ? `今天学习了 ${formatMinutes(sumMinutes(todayLogs))}。\n` + todayLogs.map(l=>`- ${l.text}${l.minutes?`：${l.minutes}分钟`:""}`).join("\n") : "今天还没有学习记录。";
  const best = Object.entries(weekLogs.reduce((o,l)=>{o[l.date]=(o[l.date]||0)+(l.minutes||0);return o;},{})).sort((a,b)=>b[1]-a[1])[0];
  $("#weeklyReport").textContent = weekLogs.length ? `本周累计 ${formatMinutes(sumMinutes(weekLogs))}。${best?`\n学习最多：${best[0]}，${formatMinutes(best[1])}。`:""}` : "本周还没有学习记录。";
}

function renderPie(map){
  const entries=Object.entries(map).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const pie=$("#pieChart"), legend=$("#pieLegend");
  if(!entries.length){ pie.style.background="var(--accent-soft)"; legend.innerHTML='<p class="hint">还没有可统计的学习记录。</p>'; return; }
  const total=entries.reduce((s,[,v])=>s+v,0);
  let start=0, parts=[];
  entries.forEach(([name,val],i)=>{ const deg=val/total*360; parts.push(`${PIE_COLORS[i]} ${start}deg ${start+deg}deg`); start+=deg; });
  pie.style.background=`conic-gradient(${parts.join(",")})`;
  legend.innerHTML=entries.map(([name,val],i)=>`<div class="legend-row"><span class="legend-left"><span class="legend-dot" style="background:${PIE_COLORS[i]}"></span>${escapeHtml(name)}</span><span>${formatMinutes(val)}</span></div>`).join("");
}

function renderHistory(){
  const data=getData();
  $("#archiveList").innerHTML=(data.archived||[]).slice().reverse().map(i=>`
    <div class="item">
      <div class="item-top"><span class="item-title">✅ ${escapeHtml(i.title)}</span><span class="hint">${i.type==="daily"?"Daily":"任务"}</span></div>
      <div class="meta-line">${itemMeta(i)} · 归档：${i.archivedAt ? new Date(i.archivedAt).toLocaleDateString("zh-CN") : ""}</div>
    </div>
  `).join("") || `<p class="hint">还没有归档记录。</p>`;
}

function initCountdowns(){
  $("#addCountdown").onclick=()=>{
    const title=$("#countTitle").value.trim(), date=$("#countDate").value, folder=$("#countFolder").value;
    if(!title||!date) return;
    const data=getData();
    data.countdowns.push({id:uid(),title,date,folder});
    $("#countTitle").value="";$("#countDate").value="";
    saveData(data);renderCountdowns();
  };
}
function renderCountdowns(){
  const data=getData();
  $("#countdownList").innerHTML=(data.countdowns||[]).map(c=>{ const diff=Math.ceil((new Date(c.date)-new Date(todayKey()))/86400000); return `<div class="count-card"><span class="folder-tag">${escapeHtml(c.folder)}</span><h3>${escapeHtml(c.title)}</h3><div class="days">${diff}</div><p class="hint">${diff>=0?`还有 ${diff} 天`:`已经过去 ${Math.abs(diff)} 天`} · ${c.date}</p><button class="mini soft-btn" onclick="deleteCountdown('${c.id}')">删除</button></div>`; }).join("") || `<p class="hint">还没有倒数日。</p>`;
}
window.deleteCountdown=id=>{ const data=getData(); data.countdowns=data.countdowns.filter(x=>x.id!==id); saveData(data); renderCountdowns(); };

function initCalendar(){
  $("#saveNote").onclick=()=>{ const data=getData(); data.notes[todayKey()]=$("#dailyNote").value.trim(); saveData(data); renderCalendar(); };
}
function renderCalendar(){
  if(!cloudData) return;
  const data=getData(), now=new Date(), y=now.getFullYear(), m=now.getMonth(), last=new Date(y,m+1,0);
  let html="";
  for(let i=1;i<=last.getDate();i++){ const key=new Date(y,m,i).toISOString().slice(0,10); const logs=data.logs[key]||[]; const minutes=sumMinutes(logs); html+=`<div class="day-cell"><strong>${i}</strong><div class="hint">${minutes?formatMinutes(minutes):""}</div>${logs.slice(-4).map(l=>`<div class="day-event">• ${escapeHtml(l.text)} ${l.minutes?`(${l.minutes}m)`:""}</div>`).join("")}${data.notes[key]?`<div class="day-event">📝 ${escapeHtml(data.notes[key]).slice(0,28)}</div>`:""}</div>`; }
  $("#calendarGrid").innerHTML=html; $("#dailyNote").value=data.notes[todayKey()]||"";
}

async function generateUniqueRoomCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for(let attempt=0;attempt<20;attempt++){ let code=""; for(let i=0;i<6;i++) code+=chars[Math.floor(Math.random()*chars.length)]; const {data}=await supabaseClient.from("study_rooms").select("room_code").eq("room_code",code).maybeSingle(); if(!data) return code; }
  return String(Date.now()).slice(-6);
}
$("#generateRoomCode")?.addEventListener("click",async()=>{ $("#roomCode").value=await generateUniqueRoomCode(); });

async function joinRealtimeRoom(){
  if(!currentSession?.user) return;
  const data=getData();
  const name=$("#roomName").value.trim()||"小水滴自习室";
  let code=$("#roomCode").value.trim();
  if(!code) code=await generateUniqueRoomCode();
  $("#roomCode").value=code;
  activeRoomCode=code;
  await supabaseClient.from("study_rooms").upsert({room_code:code,room_name:name,created_by:currentSession.user.id});
  const p=data.profile||{};
  await supabaseClient.from("room_participants").upsert({room_code:code,user_id:currentSession.user.id,display_name:p.name||currentSession.user.email||"朋友",avatar:p.avatar||"💧",study_what:$("#studyWhat").value.trim()||"",is_studying:false,total_seconds:0,today_key:todayKey(),last_seen:new Date().toISOString()});
  data.room={name,code,what:data.room?.what||"",todayMinutes:data.room?.todayMinutes||0}; saveData(data);
  $("#roomPanel").classList.remove("hidden"); $("#roomTitle").textContent=`${name} · 加入码 ${code}`;
  subscribeRoom(code); await loadRoomParticipants(); clearInterval(roomHeartbeat); roomHeartbeat=setInterval(updateRoomHeartbeat,15000);
}
async function updateRoomHeartbeat(){ if(!activeRoomCode||!currentSession?.user)return; await supabaseClient.from("room_participants").update({last_seen:new Date().toISOString()}).eq("room_code",activeRoomCode).eq("user_id",currentSession.user.id); }
function subscribeRoom(code){ if(roomChannel) supabaseClient.removeChannel(roomChannel); roomChannel=supabaseClient.channel(`room:${code}`).on("postgres_changes",{event:"*",schema:"public",table:"room_participants",filter:`room_code=eq.${code}`},()=>loadRoomParticipants()).subscribe(); }
async function loadRoomParticipants(){ if(!activeRoomCode)return; const {data,error}=await supabaseClient.from("room_participants").select("*").eq("room_code",activeRoomCode).order("total_seconds",{ascending:false}); if(error)return console.error(error); renderRealtimeRoom(data||[]); }
function secondsWithLive(p){ let total=Number(p.total_seconds||0); if(p.is_studying&&p.started_at) total+=Math.max(0,Math.floor((Date.now()-new Date(p.started_at).getTime())/1000)); return total; }
function renderRealtimeRoom(participants){ const now=Date.now(); const online=participants.filter(p=>now-new Date(p.last_seen).getTime()<45000); const seats=online.slice(0,8); while(seats.length<8)seats.push(null); $("#seatGrid").innerHTML=seats.map((p,i)=>p?`<div class="seat ${p.is_studying?"active-study":""}"><strong>${escapeHtml(p.avatar||"💧")} ${escapeHtml(p.display_name||"朋友")}</strong><p class="hint"><span class="room-status-dot"></span>${p.is_studying?"学习中":"在线"}</p><p class="hint">正在学：${escapeHtml(p.study_what||"还没填写")}</p><p class="hint">今日：${formatMinutes(Math.floor(secondsWithLive(p)/60))}</p></div>`:`<div class="seat"><p class="hint">空座位 ${i+1}</p></div>`).join(""); const ranked=[...online].sort((a,b)=>secondsWithLive(b)-secondsWithLive(a)); $("#rankList").innerHTML=ranked.map((p,i)=>`<div class="item"><div class="item-top"><span>${i+1}. ${escapeHtml(p.avatar||"💧")} ${escapeHtml(p.display_name||"朋友")}</span><strong>${formatMinutes(Math.floor(secondsWithLive(p)/60))}</strong></div></div>`).join("")||`<p class="hint">暂时还没有人在房间里。</p>`; }
async function updateStudyWhatRealtime(){ if(!activeRoomCode||!currentSession?.user)return; const what=$("#studyWhat").value.trim(); await supabaseClient.from("room_participants").update({study_what:what,last_seen:new Date().toISOString()}).eq("room_code",activeRoomCode).eq("user_id",currentSession.user.id); }
async function startRealtimeStudy(){ if(!activeRoomCode||!currentSession?.user)return; const what=$("#studyWhat").value.trim()||""; await supabaseClient.from("room_participants").update({is_studying:true,study_what:what,started_at:new Date().toISOString(),last_seen:new Date().toISOString()}).eq("room_code",activeRoomCode).eq("user_id",currentSession.user.id); $("#startStudy").textContent="学习中…"; await loadRoomParticipants(); }
async function stopRealtimeStudy(){ if(!activeRoomCode||!currentSession?.user)return; const {data:rows}=await supabaseClient.from("room_participants").select("started_at,total_seconds,study_what").eq("room_code",activeRoomCode).eq("user_id",currentSession.user.id).limit(1); const row=rows?.[0]; let add=0; if(row?.started_at) add=Math.max(0,Math.floor((Date.now()-new Date(row.started_at).getTime())/1000)); const newTotal=Number(row?.total_seconds||0)+add; const minutes=Math.max(1,Math.round(add/60)); await supabaseClient.from("room_participants").update({is_studying:false,started_at:null,total_seconds:newTotal,last_seen:new Date().toISOString()}).eq("room_code",activeRoomCode).eq("user_id",currentSession.user.id); if(add>0) logEvent(`自习室：${row?.study_what||"学习"}`,minutes,"自习室",{itemTitle:row?.study_what||"自习室",itemType:"room"}); $("#startStudy").textContent="开始学习"; await loadRoomParticipants(); renderStats(); }

function initStudyRoom(){ $("#joinRoom").onclick=joinRealtimeRoom; $("#updateStudyWhat").onclick=updateStudyWhatRealtime; $("#startStudy").onclick=startRealtimeStudy; $("#stopStudy").onclick=stopRealtimeStudy; }

function initAudio(){
  $$(".sound-btn").forEach(btn=>{ btn.onclick=()=>{ const type=btn.dataset.sound; stopSound(); $$(".sound-btn").forEach(b=>b.classList.remove("active")); if(type!=="none"){ startSound(type); btn.classList.add("active"); } }; });
  $("#soundVolume").oninput=()=>currentSoundNodes.forEach(n=>{if(n&&n.gain)n.gain.value=Number($("#soundVolume").value)/1200;});
  $("#playerToggle").onclick=()=>{ $("#floatingPlayer").classList.toggle("collapsed"); $("#playerToggle").textContent=$("#floatingPlayer").classList.contains("collapsed")?"音乐播放器 ▲":"音乐播放器 ▼"; };
  $("#loadMusic").onclick=()=>{ const url=$("#musicUrl").value.trim(); if(!url)return; $("#floatingPlayer").classList.remove("collapsed"); $("#playerToggle").textContent="音乐播放器 ▼"; $("#embedBox").innerHTML=makeEmbed(url); };
}
function ensureAudio(){ if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==="suspended")audioCtx.resume(); }
function stopSound(){ currentSoundNodes.forEach(n=>{try{if(n._interval)clearInterval(n._interval);n.stop?.();n.disconnect?.();}catch(e){}}); currentSoundNodes=[]; }
function makeNoiseSource(kind="pink"){ const bufferSize=audioCtx.sampleRate*3, buffer=audioCtx.createBuffer(1,bufferSize,audioCtx.sampleRate), out=buffer.getChannelData(0); let last=0; for(let i=0;i<bufferSize;i++){ const white=Math.random()*2-1; if(kind==="brown"){last=(last+.012*white)/1.012;out[i]=last*1.55;}else{last=.965*last+.035*white;out[i]=last*.72+white*.05;} } const src=audioCtx.createBufferSource(); src.buffer=buffer; src.loop=true; return src; }
function softTone(freq,duration=.08,volume=.004){ const osc=audioCtx.createOscillator(),g=audioCtx.createGain(); osc.type="sine";osc.frequency.value=freq;g.gain.setValueAtTime(0,audioCtx.currentTime);g.gain.linearRampToValueAtTime(volume,audioCtx.currentTime+.02);g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+duration);osc.connect(g);g.connect(audioCtx.destination);osc.start();osc.stop(audioCtx.currentTime+duration+.02);currentSoundNodes.push(osc,g); }
function startSound(type){ ensureAudio(); const gain=audioCtx.createGain(); gain.gain.value=Number($("#soundVolume").value||24)/1200; const filter=audioCtx.createBiquadFilter(); filter.type="lowpass"; filter.frequency.value=type==="rain"?1500:type==="forest"?850:type==="cafe"?690:type==="library"?520:420; filter.Q.value=.28; const src=makeNoiseSource(type==="brown"?"brown":"pink"); src.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination); src.start(); currentSoundNodes.push(src,filter,gain); }
function getYoutubeId(raw){ try{ const u=new URL(raw); if(u.hostname.includes("youtu.be"))return u.pathname.replace("/","").split("?")[0]; if(u.searchParams.get("v"))return u.searchParams.get("v"); const embed=u.pathname.match(/\/embed\/([\w-]+)/); if(embed)return embed[1]; }catch(e){} const m=raw.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{8,})/); return m?m[1]:null; }
function makeEmbed(url){ const yt=getYoutubeId(url); if(yt)return `<iframe src="https://www.youtube.com/embed/${yt}?autoplay=1" allow="autoplay; encrypted-media" allowfullscreen></iframe><p class="hint">如果某个视频不允许内嵌，就只能打开原网站播放。<br><a target="_blank" href="https://www.youtube.com/watch?v=${yt}">直接打开 YouTube</a></p>`; const bili=url.match(/bilibili\.com\/video\/(BV[\w]+)/); if(bili)return `<iframe src="https://player.bilibili.com/player.html?bvid=${bili[1]}&autoplay=1" allowfullscreen></iframe>`; if(url.includes("music.apple.com")){ const embed=url.replace("https://music.apple.com","https://embed.music.apple.com"); return `<iframe allow="autoplay *; encrypted-media *;" sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-top-navigation-by-user-activation" src="${embed}"></iframe>`; } return `<div class="embed-fallback"><p>这个链接不支持直接内嵌。<br><a href="${escapeHtml(url)}" target="_blank">点这里打开</a></p></div>`; }

function initProfile(){ const icons=["💧","🌷","☁️","🌙","⭐","📚","🎧","🧸","🐰","🦢","🕯️","🍓","🫧","🍵","🪻","🦋"]; $("#iconPicker").innerHTML=icons.map(i=>`<button class="icon-option" data-icon="${i}">${i}</button>`).join(""); $$(".icon-option").forEach(btn=>{btn.onclick=()=>{const data=getData();data.profile.avatar=btn.dataset.icon;saveData(data);renderProfile();};}); $("#saveProfile").onclick=()=>{const data=getData();data.profile.name=$("#profileName").value.trim()||"朋友";data.profile.numberFont=$("#numberFont").value;saveData(data);applyProfile(data.profile);renderProfile();}; }
function renderProfile(){ if(!cloudData)return; const data=getData(); $("#avatarPreview").textContent=data.profile.avatar||"💧"; $("#profileName").value=data.profile.name||""; $("#numberFont").value=data.profile.numberFont||"Quicksand"; $$(".icon-option").forEach(btn=>btn.classList.toggle("active",btn.dataset.icon===data.profile.avatar)); }

function renderAll(){ tickClock(); renderTimer(); renderTodos(); renderCountdowns(); renderCalendar(); renderStats(); renderHistory(); renderProfile(); refreshPomodoroTaskOptions(); restorePage(); restoreTimerState(); }

initAuth(); initNav(); initAudio(); initTodos(); initCountdowns(); initCalendar(); initStudyRoom(); initProfile();

window.addEventListener("beforeunload",()=>{ saveCloudData(); });



function hasSupabaseStoredToken(){
  try{
    return Object.keys(localStorage).some(k => k.includes("supabase") || k.includes("auth-token") || k.startsWith("sb-"));
  }catch(e){
    return false;
  }
}

function clearManualLogoutFlag(){
  manualLogout = false;
  localStorage.removeItem("xiaoshuidi-manual-logout");
}

/* =========================
   AUTH FIX: refresh should stay logged in
   ========================= */
let __bootingAuth = false;
let __enteredOnce = false;

function showLoginPage(){
  const authPage = document.getElementById("authPage");
  const mainPage = document.getElementById("mainPage");
  if(authPage) authPage.classList.remove("hidden");
  if(mainPage) mainPage.classList.add("hidden");
}

function showAppShell(){
  const authPage = document.getElementById("authPage");
  const mainPage = document.getElementById("mainPage");
  if(authPage) authPage.classList.add("hidden");
  if(mainPage) mainPage.classList.remove("hidden");
}

async function stableEnter(session){
  if(!session || !session.user) return false;
  if(__enteredOnce && currentSession?.user?.id === session.user.id) return true;

  currentSession = session;
  currentUser = session.user.email || session.user.id;

  try{
    const authMsg = document.getElementById("authMsg");
    if(authMsg) authMsg.textContent = "正在读取数据...";
    await loadCloudData(session);
    showAppShell();
    applyProfile(getData().profile);
    renderAll();
    __enteredOnce = true;
    clearManualLogoutFlag();
    return true;
  }catch(err){
    console.error("自动恢复登录失败，使用本地缓存进入：", err);
    cloudData = getLocalBackup(session) || defaultData(session.user.email);
    showAppShell();
    applyProfile(getData().profile);
    renderAll();
    __enteredOnce = true;
    clearManualLogoutFlag();
    return true;
  }
}

async function tryRefreshFromStorage(){
  try{
    const key = Object.keys(localStorage).find(k => k.startsWith("sb-") && k.endsWith("-auth-token"));
    if(!key) return null;
    const stored = JSON.parse(localStorage.getItem(key));
    const refreshToken = stored?.refresh_token;
    if(!refreshToken) return null;
    const { data, error } = await supabaseClient.auth.refreshSession({ refresh_token: refreshToken });
    if(error || !data?.session) return null;
    return data.session;
  }catch(e){ return null; }
}

async function bootAuthSession(){
  if(__bootingAuth || __enteredOnce) return;
  __bootingAuth = true;
  try{
    let { data } = await supabaseClient.auth.getSession();
    let session = data?.session;
    if(!session) session = await tryRefreshFromStorage();
    if(session && !__enteredOnce) await stableEnter(session);
  }catch(err){
    console.error("读取登录状态失败：", err);
  }finally{
    __bootingAuth = false;
  }
}

supabaseClient.auth.onAuthStateChange(async (event, session)=>{
  if((event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") && session){
    await stableEnter(session);
    return;
  }
  // INITIAL_SESSION with no session = try manual refresh before giving up
  if(event === "INITIAL_SESSION" && !session){
    const wasManual = localStorage.getItem("xiaoshuidi-manual-logout") === "1";
    if(!wasManual){
      // First try a short wait + getSession
      await new Promise(r => setTimeout(r, 400));
      const { data } = await supabaseClient.auth.getSession();
      if(data?.session){ await stableEnter(data.session); return; }
      // Then try manually refreshing with stored refresh_token
      const recovered = await tryRefreshFromStorage();
      if(recovered){ await stableEnter(recovered); return; }
    }
    __enteredOnce = false;
    currentSession = null;
    currentUser = null;
    showLoginPage();
    return;
  }
  if(event === "SIGNED_OUT"){
    const wasManual = manualLogout || localStorage.getItem("xiaoshuidi-manual-logout") === "1";
    if(wasManual){
      __enteredOnce = false;
      currentSession = null;
      currentUser = null;
      showLoginPage();
    }
    // Non-manual SIGNED_OUT (e.g. during refresh) — ignore completely,
    // INITIAL_SESSION will handle the correct state.
  }
});

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", bootAuthSession);
}else{
  bootAuthSession();
}
