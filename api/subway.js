// 지하철 실시간 도착 (서울 열린데이터광장). 키는 Vercel 환경 변수 SEOUL_SUBWAY_KEY(실시간 지하철 인증키) 에만 둔다.
// GET  : 알림 화면 배너의 "서울대입구역 2호선 교대 방면" (입력 없음)
// POST : 이동 중 위젯에서 지금 타러 가는 역. {station, line, next} 만 받고 저장하지 않는다
const LINES = {
  '1호선': '1001', '2호선': '1002', '3호선': '1003', '4호선': '1004', '5호선': '1005', '6호선': '1006', '7호선': '1007', '8호선': '1008', '9호선': '1009',
  경의중앙선: '1063', 공항철도: '1065', 경춘선: '1067', 수인분당선: '1075', 신분당선: '1077', 우이신설선: '1092', 서해선: '1093',
};
const bare = (n) => String(n || '').replace(/\s+/g, '').replace(/\(.*?\)/g, '').replace(/역$/, '').slice(0, 16);
const memo = new Map(); // 같은 역을 15초 안에 다시 묻지 않는다 (하루 한도 보호)

function arrivalText(it) {
  const sec = Number(it.barvlDt);
  if (sec >= 60) return `${Math.round(sec / 60)}분 후`;
  if (sec > 0) return '곧 도착';
  // 남은 초가 0으로 오는 경우가 많아 안내 문구("전역 출발" 등)로 대신한다
  return String(it.arvlMsg2 || '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

async function stationRows(key, station) {
  const old = memo.get(station);
  if (old && Date.now() - old.at < 15000) return old.rows;
  // 이 주소는 https 가 아니라서 페이지에서 바로 부르면 막힌다 → 서버에서 대신 부른다
  const url = `http://swopenapi.seoul.go.kr/api/subway/${encodeURIComponent(key)}/json/realtimeStationArrival/0/30/` + encodeURIComponent(station);
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`seoul ${r.status}`);
  const rows = (await r.json()).realtimeArrivalList || [];
  if (memo.size > 100) memo.clear();
  memo.set(station, { at: Date.now(), rows });
  return rows;
}

module.exports = async (req, res) => {
  const key = process.env.SEOUL_SUBWAY_KEY;
  if (!key) return res.status(200).json({ ok: false, reason: 'no-key' });

  let station = '서울대입구';
  let lineId = '1002';
  let toward = '낙성대'; // 서울대입구 → 교대는 낙성대 쪽으로 간다
  if (req.method === 'POST') {
    res.setHeader('cache-control', 'no-store');
    if (req.headers['sec-fetch-site'] !== 'same-origin') return res.status(403).json({ ok: false, reason: 'origin' });
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    body = body || {};
    station = bare(body.station);
    toward = bare(body.next);
    lineId = LINES[String(body.line || '').replace(/\s/g, '')];
    if (!station || !toward || !lineId) return res.status(400).json({ ok: false, reason: 'input' });
  }
  try {
    const list = (await stationRows(key, station)).filter(
      (it) => String(it.subwayId) === lineId && bare(String(it.trainLineNm || '').split('-').pop().replace(/방면.*$/, '')) === toward,
    );
    const arrivals = list.map(arrivalText).filter(Boolean).slice(0, 2);
    // 몇십 초마다 바뀐다 → 20초만 저장해 두고 그 뒤엔 다시 묻는다
    if (req.method !== 'POST') res.setHeader('cache-control', 's-maxage=20');
    return res.status(200).json({ ok: true, arrivals });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'error' });
  }
};
