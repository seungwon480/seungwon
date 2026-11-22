// 지하철 실시간 도착 (서울 열린데이터광장). 키는 Vercel 환경 변수 SEOUL_SUBWAY_KEY 에만 둔다.
// 소개 페이지 알림 화면 배너의 "서울대입구역 2호선 교대 방면"만 묻는다 (입력은 받지 않음).
// 서울대입구 → 교대는 낙성대 쪽으로 가는 방향이라, 도착 정보 중 "낙성대방면" 열차만 고른다.
const STATION = '서울대입구';
const LINE_ID = '1002'; // 2호선
const TOWARD = '낙성대방면';

function arrivalText(it) {
  const sec = Number(it.barvlDt);
  if (sec >= 60) return `${Math.round(sec / 60)}분 후`;
  if (sec > 0) return '곧 도착';
  // 남은 초가 0으로 오는 경우가 많아 안내 문구("전역 출발" 등)로 대신한다
  return String(it.arvlMsg2 || '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

module.exports = async (req, res) => {
  const key = process.env.SEOUL_SUBWAY_KEY;
  if (!key) return res.status(200).json({ ok: false, reason: 'no-key' });

  // 이 주소는 https 가 아니라서 페이지에서 바로 부르면 막힌다 → 서버에서 대신 부른다
  const url =
    `http://swopenapi.seoul.go.kr/api/subway/${encodeURIComponent(key)}/json/realtimeStationArrival/0/10/` +
    encodeURIComponent(STATION);

  try {
    const r = await fetch(url);
    if (!r.ok) return res.status(200).json({ ok: false, reason: `seoul ${r.status}` });
    const data = await r.json();
    const list = (data.realtimeArrivalList || []).filter(
      (it) => String(it.subwayId) === LINE_ID && String(it.trainLineNm || '').includes(TOWARD),
    );
    const arrivals = list.map(arrivalText).filter(Boolean).slice(0, 2);
    // 몇십 초마다 바뀐다 → 20초만 저장해 두고 그 뒤엔 다시 묻는다
    res.setHeader('cache-control', 's-maxage=20');
    return res.status(200).json({ ok: true, arrivals });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'error' });
  }
};
