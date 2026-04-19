'use strict';

// ── Storage ──────────────────────────────────────────────
const STORAGE_KEY = 'healthtracker_data';
const SETTINGS_KEY = 'healthtracker_settings';

function loadData() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
function loadSettings() {
  const defaults = { targetCalories: 2000, targetProtein: 150, targetFat: 60, targetCarbs: 200, eventDate: '', eventName: '', goalWeight: '', apiKey: '' };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; }
  catch { return defaults; }
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ── State ─────────────────────────────────────────────────
let data = loadData();
let settings = loadSettings();
let currentDate = todayStr();
let chartInstance = null;
let chartMetric = 'weight';
let historyFilter = 'all';
let deferredInstallPrompt = null;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Nav ───────────────────────────────────────────────────
const pages = document.querySelectorAll('.page');
const navTabs = document.querySelectorAll('.nav-tab');
navTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    navTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    pages.forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + tab.dataset.page).classList.add('active');
    if (tab.dataset.page === 'history') renderHistory();
    if (tab.dataset.page === 'chart') renderChart();
    if (tab.dataset.page === 'settings') renderSettings();
  });
});

// ── Date picker ───────────────────────────────────────────
const dateInput = document.getElementById('date-input');
dateInput.value = currentDate;
dateInput.addEventListener('change', () => { currentDate = dateInput.value; loadFormForDate(); });
document.getElementById('prev-day').addEventListener('click', () => shiftDate(-1));
document.getElementById('next-day').addEventListener('click', () => shiftDate(1));

function shiftDate(delta) {
  const d = new Date(currentDate + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  currentDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  dateInput.value = currentDate;
  loadFormForDate();
}

function loadFormForDate() {
  const entry = data[currentDate] || {};
  document.getElementById('weight').value  = entry.weight  ?? '';
  document.getElementById('bodyFat').value = entry.bodyFat ?? '';
  document.getElementById('calories').value = entry.calories ?? '';
  document.getElementById('protein').value = entry.protein ?? '';
  document.getElementById('fat').value     = entry.fat     ?? '';
  document.getElementById('carbs').value   = entry.carbs   ?? '';
  document.getElementById('memo').value    = entry.memo    ?? '';
  calManual = false;
  document.getElementById('cal-mode-badge').textContent = '自動計算';
  document.getElementById('cal-mode-badge').classList.remove('manual');
  const p = entry.protein || 0, f = entry.fat || 0, c = entry.carbs || 0;
  updatePfcHints(p, f, c);
  if (p || f || c) {
    const pCal = Math.round(p*4), fCal = Math.round(f*9), cCal = Math.round(c*4);
    document.getElementById('cal-breakdown').textContent =
      `P ${p}g × 4 = ${pCal}  +  F ${f}g × 9 = ${fCal}  +  C ${c}g × 4 = ${cCal}  =  ${pCal+fCal+cCal} kcal`;
  } else {
    document.getElementById('cal-breakdown').textContent = '';
  }
  updateTodaySummary();
}

// ── Auto-calc calories from PFC ───────────────────────────
let calManual = false;

function autoCalcCalories() {
  const p = parseFloat(document.getElementById('protein').value) || 0;
  const f = parseFloat(document.getElementById('fat').value) || 0;
  const c = parseFloat(document.getElementById('carbs').value) || 0;
  updatePfcHints(p, f, c);
  if (calManual) return;
  if (p === 0 && f === 0 && c === 0) {
    document.getElementById('calories').value = '';
    document.getElementById('cal-breakdown').textContent = '';
    return;
  }
  const pCal = Math.round(p * 4);
  const fCal = Math.round(f * 9);
  const cCal = Math.round(c * 4);
  const total = pCal + fCal + cCal;
  document.getElementById('calories').value = total;
  document.getElementById('cal-breakdown').textContent =
    `P ${p}g × 4 = ${pCal}  +  F ${f}g × 9 = ${fCal}  +  C ${c}g × 4 = ${cCal}  =  ${total} kcal`;
}

function updatePfcHints(p, f, c) {
  document.getElementById('p-kcal').textContent = p ? `${Math.round(p * 4)} kcal` : '';
  document.getElementById('f-kcal').textContent = f ? `${Math.round(f * 9)} kcal` : '';
  document.getElementById('c-kcal').textContent = c ? `${Math.round(c * 4)} kcal` : '';
}

['protein', 'fat', 'carbs'].forEach(id =>
  document.getElementById(id).addEventListener('input', autoCalcCalories)
);

// calorie manual override detection
document.getElementById('calories').addEventListener('input', () => {
  const p = parseFloat(document.getElementById('protein').value) || 0;
  const f = parseFloat(document.getElementById('fat').value) || 0;
  const c = parseFloat(document.getElementById('carbs').value) || 0;
  const auto = Math.round(p * 4 + f * 9 + c * 4);
  const manual = parseInt(document.getElementById('calories').value);
  calManual = (p || f || c) && manual !== auto;
  document.getElementById('cal-mode-badge').textContent = calManual ? '手動入力' : '自動計算';
  document.getElementById('cal-mode-badge').classList.toggle('manual', calManual);
});

// ── Form submit ───────────────────────────────────────────
document.getElementById('save-btn').addEventListener('click', saveEntry);
function saveEntry() {
  const entry = {
    weight:   parseFloat(document.getElementById('weight').value) || null,
    bodyFat:  parseFloat(document.getElementById('bodyFat').value) || null,
    calories: parseFloat(document.getElementById('calories').value) || null,
    protein:  parseFloat(document.getElementById('protein').value) || null,
    fat:      parseFloat(document.getElementById('fat').value) || null,
    carbs:    parseFloat(document.getElementById('carbs').value) || null,
    memo:     document.getElementById('memo').value.trim() || null,
  };
  // Remove null fields
  Object.keys(entry).forEach(k => entry[k] === null && delete entry[k]);

  if (Object.keys(entry).length === 0) { showToast('入力してください'); return; }

  data[currentDate] = entry;
  saveData(data);
  updateTodaySummary();
  showToast('保存しました ✓');
}

// ── Goal Card ─────────────────────────────────────────────
function updateGoalCard() {
  const card = document.getElementById('goal-card');
  const hasEvent = settings.eventDate;
  const hasGoal  = settings.goalWeight !== '';

  if (!hasEvent && !hasGoal) { card.style.display = 'none'; return; }
  card.style.display = 'block';

  // Days remaining
  const daysEl   = document.getElementById('goal-days');
  const dateLbl  = document.getElementById('goal-date-label');
  if (hasEvent) {
    const today    = new Date(todayStr() + 'T00:00:00');
    const event    = new Date(settings.eventDate + 'T00:00:00');
    const diff     = Math.ceil((event - today) / 86400000);
    if (diff > 0) {
      daysEl.textContent = diff;
      daysEl.style.color = diff <= 7 ? 'var(--danger)' : diff <= 30 ? 'var(--warn)' : 'var(--accent2)';
    } else if (diff === 0) {
      daysEl.textContent = '当日';
      daysEl.style.color = 'var(--danger)';
    } else {
      daysEl.textContent = `+${Math.abs(diff)}`;
      daysEl.style.color = 'var(--text2)';
    }
    const eventLabel = settings.eventName || '大会';
    const d = new Date(settings.eventDate + 'T00:00:00');
    dateLbl.textContent = `${eventLabel}（${d.getMonth()+1}/${d.getDate()}）`;
  } else {
    daysEl.textContent = '—';
    dateLbl.textContent = '大会日未設定';
  }

  // Weight remaining
  const kgEl    = document.getElementById('goal-kg');
  const wgtLbl  = document.getElementById('goal-weight-label');
  if (hasGoal) {
    // Find latest weight entry
    const latestWeight = (() => {
      const dates = Object.keys(data).sort((a,b) => b.localeCompare(a));
      for (const d of dates) { if (data[d].weight != null) return data[d].weight; }
      return null;
    })();
    const goal = parseFloat(settings.goalWeight);
    if (latestWeight != null) {
      const diff = latestWeight - goal;
      kgEl.textContent = Math.abs(diff).toFixed(1);
      kgEl.style.color = diff <= 0 ? 'var(--success)' : diff <= 1 ? 'var(--warn)' : 'var(--accent2)';
      wgtLbl.textContent = diff <= 0
        ? `目標達成！（現在 ${latestWeight} kg）`
        : `目標 ${goal} kg（現在 ${latestWeight} kg）`;
    } else {
      kgEl.textContent = '—';
      wgtLbl.textContent = `目標 ${goal} kg（体重未記録）`;
    }
  } else {
    kgEl.textContent = '—';
    wgtLbl.textContent = '目標体重未設定';
  }
}

// ── Summary ───────────────────────────────────────────────
function updateTodaySummary() {
  const entry = data[currentDate] || {};

  // 体重・体脂肪
  document.getElementById('sum-weight').textContent = entry.weight  != null ? (+entry.weight).toFixed(1)  : '—';
  document.getElementById('sum-fat').textContent    = entry.bodyFat != null ? (+entry.bodyFat).toFixed(1) : '—';

  // 目標との比較
  renderTargetCompare(entry);

  // PFC balance bar
  const p = entry.protein || 0, f = entry.fat || 0, c = entry.carbs || 0;
  const pcal = p*4, fcal = f*9, ccal = c*4;
  const total = pcal + fcal + ccal || 1;
  document.getElementById('bar-p').style.width = (pcal/total*100) + '%';
  document.getElementById('bar-f').style.width = (fcal/total*100) + '%';
  document.getElementById('bar-c').style.width = (ccal/total*100) + '%';
  document.getElementById('pfc-pct').textContent =
    (p||f||c) ? `P ${Math.round(pcal/total*100)}%  F ${Math.round(fcal/total*100)}%  C ${Math.round(ccal/total*100)}%` : '';

  updateGoalCard();
}

function renderTargetCompare(entry) {
  const rows = [
    { key: 'cal', actual: entry.calories != null ? Math.round(entry.calories) : null,
      target: settings.targetCalories, unit: 'kcal', label: 'カロリー', barClass: 'tc-bar-cal' },
    { key: 'p',   actual: entry.protein  != null ? +entry.protein  : null,
      target: settings.targetProtein,  unit: 'g',    label: 'P', barClass: 'tc-bar-p' },
    { key: 'f',   actual: entry.fat      != null ? +entry.fat      : null,
      target: settings.targetFat,      unit: 'g',    label: 'F', barClass: 'tc-bar-f' },
    { key: 'c',   actual: entry.carbs    != null ? +entry.carbs    : null,
      target: settings.targetCarbs,    unit: 'g',    label: 'C', barClass: 'tc-bar-c' },
  ];

  for (const r of rows) {
    const actualEl = document.getElementById(`tc-${r.key}-actual`);
    const sepEl    = document.getElementById(`tc-${r.key}-sep`);
    const targetEl = document.getElementById(`tc-${r.key}-target`);
    const diffEl   = document.getElementById(`tc-${r.key}-diff`);
    const barEl    = document.getElementById(`tc-${r.key}-bar`);

    if (r.actual == null) {
      actualEl.textContent = '—';
      sepEl.style.display  = 'none';
      diffEl.textContent   = '';
      diffEl.className     = 'tc-diff';
      barEl.style.width    = '0%';
      continue;
    }

    const pct  = Math.min(r.actual / r.target * 100, 150);
    const diff = Math.round((r.actual - r.target) * 10) / 10;
    const sign = diff > 0 ? '+' : '';

    actualEl.textContent = r.actual;
    sepEl.style.display  = '';
    targetEl.textContent = r.target;
    barEl.style.width    = Math.min(pct, 100) + '%';

    // over-target: flash bar to danger color via class
    barEl.classList.toggle('over', pct > 105);

    if (Math.abs(diff) < (r.unit === 'kcal' ? 20 : 2)) {
      diffEl.textContent = '達成';
      diffEl.className   = 'tc-diff achieved';
    } else {
      diffEl.textContent = `${sign}${diff} ${r.unit}`;
      diffEl.className   = `tc-diff ${diff < 0 ? 'under' : 'over'}`;
    }
  }

  // PFC calorie sub-line under calories row
  const p = entry.protein || 0, f = entry.fat || 0, c = entry.carbs || 0;
  const subEl = document.getElementById('tc-pfc-sub');
  if (p || f || c) {
    subEl.textContent =
      `P ${Math.round(p*4)} + F ${Math.round(f*9)} + C ${Math.round(c*4)} kcal`;
  } else {
    subEl.textContent = '';
  }
}

// ── History ───────────────────────────────────────────────
const filterBtns = document.querySelectorAll('.filter-btn');
filterBtns.forEach(b => {
  b.addEventListener('click', () => {
    filterBtns.forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    historyFilter = b.dataset.filter;
    renderHistory();
  });
});

function renderHistory() {
  const list = document.getElementById('history-list');
  let dates = Object.keys(data).sort((a,b) => b.localeCompare(a));

  if (historyFilter !== 'all') {
    const now = new Date();
    const cutoff = new Date();
    if (historyFilter === '7') cutoff.setDate(now.getDate() - 7);
    if (historyFilter === '30') cutoff.setDate(now.getDate() - 30);
    dates = dates.filter(d => new Date(d) >= cutoff);
  }

  if (dates.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>記録がありません</p></div>`;
    return;
  }

  list.innerHTML = dates.map(d => {
    const e = data[d];
    const badges = [];
    if (e.weight != null) badges.push(`<span class="history-badge weight">${e.weight} kg</span>`);
    if (e.bodyFat != null) badges.push(`<span class="history-badge">${e.bodyFat}%</span>`);
    if (e.calories != null) badges.push(`<span class="history-badge">${Math.round(e.calories)} kcal</span>`);
    if (e.protein != null) badges.push(`<span class="history-badge">P ${e.protein}g</span>`);
    if (e.fat != null) badges.push(`<span class="history-badge">F ${e.fat}g</span>`);
    if (e.carbs != null) badges.push(`<span class="history-badge">C ${e.carbs}g</span>`);
    const displayDate = new Date(d + 'T00:00:00').toLocaleDateString('ja-JP', { year:'numeric', month:'short', day:'numeric', weekday:'short' });
    return `
      <div class="history-item" data-date="${d}">
        <div>
          <div class="history-date">${displayDate}</div>
          <div class="history-meta">${badges.join('')}</div>
          ${e.memo ? `<div style="font-size:.78rem;color:var(--text2);margin-top:4px">${e.memo}</div>` : ''}
        </div>
        <div></div>
        <button class="history-delete" data-date="${d}" title="削除">🗑</button>
      </div>`;
  }).join('');

  list.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.classList.contains('history-delete')) return;
      currentDate = item.dataset.date;
      dateInput.value = currentDate;
      navTabs[0].click();
      loadFormForDate();
    });
  });
  list.querySelectorAll('.history-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm(`${btn.dataset.date} のデータを削除しますか？`)) return;
      delete data[btn.dataset.date];
      saveData(data);
      renderHistory();
      showToast('削除しました');
    });
  });
}

// ── Chart ─────────────────────────────────────────────────
let chartPeriod = 'daily';

document.getElementById('metric-btns').addEventListener('click', e => {
  const btn = e.target.closest('.chart-toggle');
  if (!btn) return;
  document.querySelectorAll('#metric-btns .chart-toggle').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  chartMetric = btn.dataset.metric;
  renderChart();
});
document.getElementById('period-btns').addEventListener('click', e => {
  const btn = e.target.closest('.chart-toggle');
  if (!btn) return;
  document.querySelectorAll('#period-btns .chart-toggle').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  chartPeriod = btn.dataset.period;
  renderChart();
});

// ISO week key: "YYYY-Www"
function weekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day);
  const y = d.getFullYear();
  const w = Math.ceil(((d - new Date(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2,'0')}`;
}

// Monday of the given week key
function weekMonday(key) {
  const [y, w] = key.split('-W').map(Number);
  const jan4 = new Date(y, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1 + (w - 1) * 7);
  return monday;
}

function aggregateWeekly(dates, key) {
  const weeks = {};
  for (const d of dates) {
    const v = data[d][key];
    if (v == null) continue;
    const wk = weekKey(d);
    if (!weeks[wk]) weeks[wk] = [];
    weeks[wk].push(+v);
  }
  const sortedWeeks = Object.keys(weeks).sort();
  const labels = sortedWeeks.map(wk => {
    const m = weekMonday(wk);
    return `${m.getMonth()+1}/${m.getDate()}週`;
  });
  const values = sortedWeeks.map(wk => {
    const arr = weeks[wk];
    return Math.round(arr.reduce((a,b) => a+b, 0) / arr.length * 10) / 10;
  });
  return { labels, values };
}

function aggregateWeeklyBoth(dates) {
  const weeks = {};
  for (const d of dates) {
    const wk = weekKey(d);
    if (!weeks[wk]) weeks[wk] = { weight: [], bodyFat: [] };
    if (data[d].weight != null)  weeks[wk].weight.push(+data[d].weight);
    if (data[d].bodyFat != null) weeks[wk].bodyFat.push(+data[d].bodyFat);
  }
  const sortedWeeks = Object.keys(weeks).sort();
  const avg = arr => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length*10)/10 : null;
  const labels  = sortedWeeks.map(wk => { const m = weekMonday(wk); return `${m.getMonth()+1}/${m.getDate()}週`; });
  const weights = sortedWeeks.map(wk => avg(weeks[wk].weight));
  const fats    = sortedWeeks.map(wk => avg(weeks[wk].bodyFat));
  return { labels, weights, fats };
}

const METRIC_MAP = {
  weight:   { key: 'weight',   label: '体重',       unit: 'kg',   color: '#818cf8' },
  bodyFat:  { key: 'bodyFat',  label: '体脂肪率',   unit: '%',    color: '#f43f5e' },
  calories: { key: 'calories', label: 'カロリー',   unit: 'kcal', color: '#f59e0b' },
  protein:  { key: 'protein',  label: 'タンパク質', unit: 'g',    color: '#3b82f6' },
  fat:      { key: 'fat',      label: '脂質',       unit: 'g',    color: '#f59e0b' },
  carbs:    { key: 'carbs',    label: '炭水化物',   unit: 'g',    color: '#10b981' },
};

const CHART_DEFAULTS = {
  borderWidth: 2.5,
  pointRadius: 4,
  pointBorderColor: '#1e293b',
  pointBorderWidth: 2,
  tension: 0.35,
  spanGaps: true,
};

function makeDataset(label, values, color, yAxisID = 'y', fill = true) {
  return {
    ...CHART_DEFAULTS,
    label,
    data: values,
    borderColor: color,
    backgroundColor: color + '22',
    pointBackgroundColor: color,
    fill,
    yAxisID,
  };
}

function renderChart() {
  const allDates = Object.keys(data).sort();
  const isEmpty  = allDates.length === 0;
  document.getElementById('chart-empty').style.display = isEmpty ? 'block' : 'none';
  document.getElementById('myChart').style.display = isEmpty ? 'none' : 'block';
  if (isEmpty) { renderChartLegend([]); renderChartStats(null, null); return; }

  const ctx = document.getElementById('myChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  const isBoth   = chartMetric === 'both';
  const isWeekly = chartPeriod === 'weekly';

  // ── Both: weight + bodyFat dual-axis ──
  if (isBoth) {
    let labels, wVals, fVals;
    if (isWeekly) {
      ({ labels, weights: wVals, fats: fVals } = aggregateWeeklyBoth(allDates));
    } else {
      labels = allDates.map(d => { const dt = new Date(d+'T00:00:00'); return `${dt.getMonth()+1}/${dt.getDate()}`; });
      wVals  = allDates.map(d => data[d].weight  ?? null);
      fVals  = allDates.map(d => data[d].bodyFat ?? null);
    }

    renderChartLegend([
      { label: '体重 (kg)',   color: '#818cf8' },
      { label: '体脂肪率 (%)', color: '#f43f5e' },
    ]);
    renderChartStats(
      { values: wVals, unit: 'kg' },
      { values: fVals, unit: '%'  }
    );

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          makeDataset('体重 (kg)',    wVals, '#818cf8', 'yW', true),
          makeDataset('体脂肪率 (%)', fVals, '#f43f5e', 'yF', false),
        ],
      },
      options: chartOptions({
        yW: { position: 'left',  title: 'kg', color: '#818cf8' },
        yF: { position: 'right', title: '%',  color: '#f43f5e', grid: false },
      }),
    });
    return;
  }

  // ── Single metric ──
  const m = METRIC_MAP[chartMetric];
  let labels, values;
  if (isWeekly) {
    ({ labels, values } = aggregateWeekly(allDates, m.key));
  } else {
    labels = allDates.map(d => { const dt = new Date(d+'T00:00:00'); return `${dt.getMonth()+1}/${dt.getDate()}`; });
    values = allDates.map(d => data[d][m.key] ?? null);
  }

  renderChartLegend([{ label: `${m.label} (${m.unit})`, color: m.color }]);
  renderChartStats(null, null);

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [makeDataset(`${m.label} (${m.unit})`, values, m.color, 'y', true)] },
    options: chartOptions({ y: { position: 'left', title: m.unit, color: m.color } }),
  });
}

function chartOptions(axes) {
  const scales = { x: { grid: { color: 'rgba(51,65,85,0.5)' }, ticks: { color: '#94a3b8', font: { size: 11 }, maxTicksLimit: 10 } } };
  for (const [id, cfg] of Object.entries(axes)) {
    scales[id] = {
      position: cfg.position,
      grid: { color: cfg.grid === false ? 'transparent' : 'rgba(51,65,85,0.5)' },
      ticks: { color: cfg.color, font: { size: 11 } },
      title: { display: true, text: cfg.title, color: cfg.color, font: { size: 10 } },
    };
  }
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1e293b',
        borderColor: '#334155',
        borderWidth: 1,
        titleColor: '#94a3b8',
        bodyColor: '#f1f5f9',
        callbacks: { label: ctx => ctx.parsed.y != null ? ` ${ctx.dataset.label}: ${ctx.parsed.y}` : null },
      },
    },
    scales,
  };
}

function renderChartLegend(items) {
  const el = document.getElementById('chart-legend');
  el.innerHTML = items.map(it =>
    `<span class="cl-item"><i style="background:${it.color}"></i>${it.label}</span>`
  ).join('');
}

function renderChartStats(weightData, fatData) {
  const statsEl = document.getElementById('chart-stats');
  if (!weightData && !fatData) { statsEl.style.display = 'none'; return; }
  statsEl.style.display = 'grid';

  const calc = d => {
    if (!d) return { latest: '—', diff: '—', diffClass: '' };
    const vals = d.values.filter(v => v != null);
    if (vals.length === 0) return { latest: '—', diff: '—', diffClass: '' };
    const latest = vals[vals.length - 1];
    const first  = vals[0];
    const delta  = Math.round((latest - first) * 10) / 10;
    const sign   = delta > 0 ? '+' : '';
    return {
      latest: `${latest} ${d.unit}`,
      diff: `${sign}${delta} ${d.unit}`,
      diffClass: delta < 0 ? 'diff-down' : delta > 0 ? 'diff-up' : '',
    };
  };

  const w = calc(weightData);
  const f = calc(fatData);
  document.getElementById('cs-weight-latest').textContent = w.latest;
  document.getElementById('cs-weight-diff').textContent   = w.diff;
  document.getElementById('cs-weight-diff').className     = `chart-stat-val ${w.diffClass}`;
  document.getElementById('cs-fat-latest').textContent    = f.latest;
  document.getElementById('cs-fat-diff').textContent      = f.diff;
  document.getElementById('cs-fat-diff').className        = `chart-stat-val ${f.diffClass}`;
}

// ── Settings ──────────────────────────────────────────────
function renderSettings() {
  document.getElementById('set-api-key').value     = settings.apiKey      || '';
  document.getElementById('set-event-date').value  = settings.eventDate   || '';
  document.getElementById('set-event-name').value  = settings.eventName   || '';
  document.getElementById('set-goal-weight').value = settings.goalWeight  !== '' ? settings.goalWeight : '';
  document.getElementById('set-calories').value = settings.targetCalories;
  document.getElementById('set-protein').value  = settings.targetProtein;
  document.getElementById('set-fat').value      = settings.targetFat;
  document.getElementById('set-carbs').value    = settings.targetCarbs;
  updateSSCardHint();
}
document.getElementById('settings-save').addEventListener('click', () => {
  settings.apiKey         = document.getElementById('set-api-key').value.trim();
  settings.eventDate      = document.getElementById('set-event-date').value || '';
  settings.eventName      = document.getElementById('set-event-name').value.trim() || '';
  settings.goalWeight     = document.getElementById('set-goal-weight').value !== '' ? parseFloat(document.getElementById('set-goal-weight').value) : '';
  settings.targetCalories = parseInt(document.getElementById('set-calories').value) || 2000;
  settings.targetProtein  = parseInt(document.getElementById('set-protein').value)  || 150;
  settings.targetFat      = parseInt(document.getElementById('set-fat').value)      || 60;
  settings.targetCarbs    = parseInt(document.getElementById('set-carbs').value)    || 200;
  saveSettings(settings);
  updateTodaySummary();
  updateSSCardHint();
  showToast('設定を保存しました ✓');
});

// API key show/hide toggle
document.getElementById('api-key-toggle').addEventListener('click', () => {
  const inp = document.getElementById('set-api-key');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});
document.getElementById('export-btn').addEventListener('click', exportCSV);
document.getElementById('clear-btn').addEventListener('click', () => {
  if (!confirm('すべてのデータを削除しますか？この操作は取り消せません。')) return;
  localStorage.removeItem(STORAGE_KEY);
  data = {};
  loadFormForDate();
  showToast('データを削除しました');
});

function exportCSV() {
  const rows = [['日付','体重(kg)','体脂肪率(%)','カロリー(kcal)','タンパク質(g)','脂質(g)','炭水化物(g)','メモ']];
  Object.keys(data).sort().forEach(d => {
    const e = data[d];
    rows.push([d, e.weight??'', e.bodyFat??'', e.calories??'', e.protein??'', e.fat??'', e.carbs??'', e.memo??'']);
  });
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `healthtracker_${todayStr()}.csv`; a.click();
  URL.revokeObjectURL(url);
  showToast('CSVをエクスポートしました');
}

// ── Screenshot Analysis ───────────────────────────────────
function updateSSCardHint() {
  document.getElementById('ss-no-key').style.display = settings.apiKey ? 'none' : 'block';
}

function setSSState(state, text = '') {
  ['idle', 'loading', 'result', 'error'].forEach(s => {
    document.getElementById(`ss-${s}`).style.display = s === state ? 'flex' : 'none';
  });
  if (text) {
    const el = document.getElementById(`ss-${state}-text`);
    if (el) el.textContent = text;
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const [header, data] = e.target.result.split(',');
      resolve({ base64: data, mediaType: header.match(/:(.*?);/)[1] });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function analyzeScreenshot(base64, mediaType) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: `このアプリのスクリーンショットから1日の合計栄養摂取量と体組成データを抽出してください。
カロミルや他の食事記録アプリに対応しています。画面に表示されている合計値を使用してください。

JSONのみを返してください（前後の説明不要）：
{"calories":数値orNull,"protein":数値orNull,"fat":数値orNull,"carbs":数値orNull,"weight":数値orNull,"bodyFat":数値orNull}

・calories: 合計カロリー（kcal）
・protein: タンパク質の合計（g）
・fat: 脂質の合計（g）
・carbs: 炭水化物の合計（g）
・weight: 体重（kg）、あれば
・bodyFat: 体脂肪率（%）、あれば
見つからない値はnullにしてください。数値は小数点を保持してください。` }
        ],
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || `APIエラー (${res.status})`;
    if (res.status === 401) throw new Error('APIキーが無効です');
    if (res.status === 429) throw new Error('API制限に達しました。しばらく待ってください');
    throw new Error(msg);
  }

  const json = await res.json();
  const text = json.content?.[0]?.text || '';

  // Extract JSON object from response (may be wrapped in markdown)
  const match = text.replace(/```json\n?|```\n?/g, '').match(/\{[\s\S]*?\}/);
  if (!match) throw new Error('データを読み取れませんでした');

  const parsed = JSON.parse(match[0]);
  // Coerce values
  return Object.fromEntries(
    Object.entries(parsed).map(([k, v]) => [k, v != null && !isNaN(+v) ? +v : null])
  );
}

async function processImageFile(file) {
  if (!settings.apiKey) {
    updateSSCardHint();
    showToast('設定からAPIキーを入力してください');
    return;
  }
  if (!file.type.startsWith('image/')) { showToast('画像ファイルを選択してください'); return; }

  setSSState('loading');

  try {
    const { base64, mediaType } = await fileToBase64(file);
    const result = await analyzeScreenshot(base64, mediaType);

    const filled = [];
    const hasPFC = result.protein != null || result.fat != null || result.carbs != null;

    if (result.weight   != null) { document.getElementById('weight').value   = result.weight;   filled.push(`体重 ${result.weight}kg`); }
    if (result.bodyFat  != null) { document.getElementById('bodyFat').value  = result.bodyFat;  filled.push(`体脂肪 ${result.bodyFat}%`); }
    if (result.protein  != null) { document.getElementById('protein').value  = result.protein;  filled.push(`P ${result.protein}g`); }
    if (result.fat      != null) { document.getElementById('fat').value      = result.fat;      filled.push(`F ${result.fat}g`); }
    if (result.carbs    != null) { document.getElementById('carbs').value    = result.carbs;    filled.push(`C ${result.carbs}g`); }

    if (hasPFC) {
      // PFC detected → auto-calculate calories
      calManual = false;
      document.getElementById('cal-mode-badge').textContent = '自動計算';
      document.getElementById('cal-mode-badge').classList.remove('manual');
      autoCalcCalories();
    } else if (result.calories != null) {
      // Only calorie total → manual
      document.getElementById('calories').value = result.calories;
      calManual = true;
      document.getElementById('cal-mode-badge').textContent = '手動入力';
      document.getElementById('cal-mode-badge').classList.add('manual');
    }
    if (result.calories != null && !hasPFC) filled.push(`${result.calories}kcal`);

    updateTodaySummary();

    if (filled.length === 0) {
      setSSState('error', '数値が見つかりませんでした');
    } else {
      setSSState('result', filled.join('  '));
      showToast(`${filled.length}件を自動入力しました`);
    }
  } catch (err) {
    setSSState('error', err.message);
  }
}

// ── Screenshot zone events ─────────────────────────────────
const ssZone = document.getElementById('ss-zone');
const ssFile = document.getElementById('ss-file');

ssZone.addEventListener('click', () => ssFile.click());
ssFile.addEventListener('change', e => {
  if (e.target.files[0]) processImageFile(e.target.files[0]);
  e.target.value = '';
});

// Drag & Drop
ssZone.addEventListener('dragover', e => { e.preventDefault(); ssZone.classList.add('drag-over'); });
ssZone.addEventListener('dragleave', () => ssZone.classList.remove('drag-over'));
ssZone.addEventListener('drop', e => {
  e.preventDefault();
  ssZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) processImageFile(f);
});

// Global paste (works anywhere on input page)
document.addEventListener('paste', e => {
  if (!document.getElementById('page-input').classList.contains('active')) return;
  // Don't intercept paste in text inputs
  if (['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;
  const img = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
  if (img) processImageFile(img.getAsFile());
});

// ── Toast ─────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ── PWA Install ───────────────────────────────────────────
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('install-banner').classList.add('show');
});
document.getElementById('install-btn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') {
    document.getElementById('install-banner').classList.remove('show');
    deferredInstallPrompt = null;
  }
});
window.addEventListener('appinstalled', () => {
  document.getElementById('install-banner').classList.remove('show');
  deferredInstallPrompt = null;
  showToast('インストールしました！');
});

// ── Service Worker ────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ── Init ──────────────────────────────────────────────────
loadFormForDate();
updateSSCardHint();
