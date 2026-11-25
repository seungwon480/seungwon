// 대중교통 경로 (카카오맵 REST API). 키는 Vercel 환경 변수 KAKAO_REST_API_KEY 에만 둔다.
// 출발지는 시연용 예시 집(관악구 신림동) 하나로 고정한다. 고객의 위치나 집 주소는 받지 않는다.
// 도착지는 좌표(x, y)나 장소 이름(q)으로 받고, 저장하지 않는다. 지하철은 서울시 열차 시간표로 실제 열차를 찾는다.
const HOME = { x: '126.9290', y: '37.4810' };

const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const inKorea = (x, y) => x > 124 && x < 132 && y > 33 && y < 39;

// ── 서울시 지하철 역별 열차 시간표 (서울 열린데이터광장, 키는 환경 변수 SEOUL_OPENAPI_KEY) ──
const memo = new Map();
async function seoul(path) {
  const key = process.env.SEOUL_OPENAPI_KEY;
  if (!key) return [];
  if (memo.has(path)) return memo.get(path);
  const r = await fetch(`http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/${path}`, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) return [];
  const data = await r.json();
  const box = data[path.split('/')[0]];
  const rows = (box && box.row) || [];
  if (rows.length) { if (memo.size > 200) memo.clear(); memo.set(path, rows); }
  return rows;
}
const bare = (n) => clean(n, 30).replace(/\(.*?\)/g, '').replace(/역$/, '');
const lineKey = (n) => { const m = /(\d+)\s*호선/.exec(n); return m ? `0${m[1]}호선` : clean(n, 14).replace(/\s/g, ''); };
const sec = (t) => { const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; };
async function codeOf(name, line) {
  const rows = await seoul(`SearchInfoBySubwayNameService/1/20/${encodeURIComponent(bare(name))}`);
  const hit = rows.find((x) => bare(x.STATION_NM) === bare(name) && x.LINE_NUM === lineKey(line));
  return hit && hit.STATION_CD;
}
// by(분) 까지 to 역에 닿는 가장 늦은 열차. 두 역에 모두 서는 같은 열차 번호를 찾으므로 방향을 따로 몰라도 된다
async function lastTrain(ride, day, by) {
  const [c1, c2] = await Promise.all([codeOf(ride.from, ride.line), codeOf(ride.to, ride.line)]);
  if (!c1 || !c2) return null;
  let best = null;
  await Promise.all([1, 2].map(async (way) => {
    const [a, b] = await Promise.all([c1, c2].map((c) => seoul(`SearchSTNTimeTableByIDService/1/1000/${c}/${day}/${way}`)));
    const arrive = new Map(b.map((x) => [x.TRAIN_NO, sec(x.ARRIVETIME)]));
    for (const x of a) {
      const d = sec(x.LEFTTIME);
      const e = arrive.get(x.TRAIN_NO) || 0;
      // 순환선을 반대로 크게 도는 열차는 뺀다 (예상 시간의 1.6배 + 3분 안)
      if (d && e > d && e <= by * 60 && e - d <= (ride.dur * 1.6 + 3) * 60 && (!best || d > best.d)) best = { d, e };
    }
  }));
  return best && { dep: Math.floor(best.d / 60), arr: Math.ceil(best.e / 60) };
}

// 카카오 경로 하나를 "어디서 무엇을 몇 분 타는지" 로 줄인다
// 카카오는 집에서 첫 정류장, 마지막 정류장에서 목적지까지 걷는 시간을 빼고 주기도 한다 → 좌표 거리로 더한다
// (직선거리의 1.3배를 1분에 67m 로 걷는다고 본다)
function footMin(a, b) {
  if (!a || !b || !inKorea(a[0], a[1]) || !inKorea(b[0], b[1])) return 0;
  const dx = (a[0] - b[0]) * 88000;
  const dy = (a[1] - b[1]) * 111000;
  return (Math.hypot(dx, dy) * 1.3) / 67;
}
function shorten(route, from0, to0) {
  const raw = route.steps || [];
  const steps = raw.map((x) => x.properties || {});
  const moving = raw.filter((x) => x.properties && x.properties.type !== 'WALKING');
  const pts = (x) => (x && x.path && x.path.points) || [];
  const first = pts(moving[0])[0];
  const last = pts(moving[moving.length - 1]).slice(-1)[0];
  const head = steps[0] && steps[0].type !== 'WALKING' ? footMin(from0, first) : 0;
  const foot = steps.length && steps[steps.length - 1].type !== 'WALKING' ? footMin(last, to0) : 0;
  const total = Math.ceil(Number(route.properties && route.properties.totalTime) / 60);
  const n = steps.filter((p) => p.type === 'BUS' || p.type === 'SUBWAY').length;
  // 구간 시간의 합과 전체 시간의 차이(기다리는 시간)는 타기 전에 고르게 나눈다
  const sum = steps.reduce((a, p) => a + (Number(p.time) || 0), 0) / 60;
  const wait = n ? Math.max(0, total - sum) / n : 0;
  let walk = head;
  const rides = [];
  for (const p of steps) {
    const min = (Number(p.time) || 0) / 60;
    if (p.type !== 'BUS' && p.type !== 'SUBWAY') { walk += min; continue; }
    const sub = p.type === 'SUBWAY';
    const stops = p.stops || [];
    const line = clean((p.vehicles && p.vehicles[0] && p.vehicles[0].name) || '', 14);
    const stop = (x) => { const name = clean(x && x.name, 18); return sub && name && !/역$/.test(name) ? `${name}역` : name; };
    const from = stop(stops[0]);
    const to = stop(stops[stops.length - 1]);
    if (!line || !from || !to) return null;
    rides.push({ m: sub ? 'sub' : 'bus', line, from, to, nx: sub ? stop(stops[1]) : '', walk: Math.ceil(walk), wait, dur: Math.max(1, Math.round(min)) });
    walk = 0;
  }
  if (!rides.length || rides.length > 6 || !(total > 0 && total <= 240)) return null;
  return { total: total + Math.ceil(head) + Math.ceil(foot), rides, tail: Math.ceil(walk + foot) };
}

// 도착해야 할 시각에서 거꾸로 계산한다. 지하철은 시간표의 실제 열차로, 못 찾으면 카카오 예상 시간으로
async function backward(plan, day, by) {
  let t = by - plan.tail;
  const out = [];
  for (let i = plan.rides.length - 1; i >= 0; i--) {
    const r = plan.rides[i];
    let hit = null;
    if (r.m === 'sub' && day) { try { hit = await lastTrain(r, day, t); } catch (e) { hit = null; } }
    const arr = hit ? hit.arr : t;
    const dep = hit ? hit.dep : Math.round(t - r.dur);
    out.unshift({ m: r.m, line: r.line, from: r.from, to: r.to, nx: r.nx, dep, arr, tt: !!hit });
    t = Math.floor(dep - r.walk - (hit ? 1 : r.wait)); // 시간표 열차는 1분 먼저 승강장에
  }
  const min = by - t;
  if (!(min > 0 && min <= 240)) return null;
  return { min, rides: out.map((r) => ({ m: r.m, line: r.line, from: r.from, to: r.to, nx: r.nx, at: r.dep - t, dur: Math.max(1, r.arr - r.dep), tt: r.tt })) };
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method' });
  if (req.headers['sec-fetch-site'] !== 'same-origin') return res.status(403).json({ ok: false, reason: 'origin' });
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return res.status(200).json({ ok: false, reason: 'no-key' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  body = body || {};
  let x = Number(body.x);
  let y = Number(body.y);
  const q = typeof body.q === 'string' ? body.q.trim().slice(0, 40).replace(/\s+(앞|근처|쪽)$/, '') : ''; // "신촌역 2번 출구 앞" → "신촌역 2번 출구"
  const headers = { Authorization: `KakaoAK ${key}` };
  try {
    if (!inKorea(x, y)) {
      if (q.length < 2) return res.status(400).json({ ok: false, reason: 'short' });
      const r = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?size=1&query=${encodeURIComponent(q)}`, { headers });
      const d = r.ok ? ((await r.json()).documents || [])[0] : null;
      if (!d) return res.status(200).json({ ok: false, reason: 'place' });
      x = Number(d.x);
      y = Number(d.y);
    }
    const u = `https://dapi.kakao.com/v2/routing/publictraffic?start_x=${HOME.x}&start_y=${HOME.y}&end_x=${x}&end_y=${y}`;
    const r = await fetch(u, { headers });
    if (!r.ok) return res.status(200).json({ ok: false, reason: `kakao ${r.status}` });
    const data = await r.json();
    if (data.status !== 'OK') return res.status(200).json({ ok: false, reason: clean(data.status, 30) });
    // 걸어가서 지하철만 타는 경로가 10분 안 차이면 먼저 고른다 (짧은 마을버스를 끼우지 않게)
    const cost = (p) => p.total + (p.rides.some((x) => x.m === 'bus') ? 10 : 0);
    const list = (data.routes || []).map((r) => shorten(r, [Number(HOME.x), Number(HOME.y)], [x, y])).filter(Boolean).sort((a, b) => cost(a) - cost(b));
    if (!list.length) return res.status(200).json({ ok: false, reason: 'none' });
    // 도착해야 할 시각(분)과 요일. 1 평일 · 2 토요일 · 3 일요일 (공휴일은 구분하지 않는다)
    const by = Number(body.by) > 0 && Number(body.by) < 1440 ? Math.round(Number(body.by)) : 600;
    const dow = Number.isInteger(body.dow) && body.dow >= 0 && body.dow <= 6 ? body.dow : -1;
    const day = dow < 0 || !body.by ? 0 : dow === 0 ? 3 : dow === 6 ? 2 : 1;
    const got = await backward(list[0], day, by);
    if (!got) return res.status(200).json({ ok: false, reason: 'none' });
    return res.status(200).json({ ok: true, ...got });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'error' });
  }
};
