// 공휴일 (한국천문연구원 특일 정보, 공공데이터포털). 키는 Vercel 환경 변수 DATA_GO_KR_KEY 에만 둔다.
// 공공데이터포털은 일반 인증키를 Encoding·Decoding 두 가지로 주는데 어느 쪽을 넣어도 되게 한다.
module.exports = async (req, res) => {
  const year = String(req.query.year || '');
  const month = String(req.query.month || '');
  if (!/^\d{4}$/.test(year) || !/^(0?[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ ok: false, reason: 'bad-date' });
  }
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) return res.status(200).json({ ok: false, reason: 'no-key' });

  const serviceKey = key.includes('%') ? key : encodeURIComponent(key);
  const url =
    'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo' +
    `?serviceKey=${serviceKey}&solYear=${year}&solMonth=${month.padStart(2, '0')}&numOfRows=50&_type=json`;

  try {
    const r = await fetch(url);
    if (!r.ok) return res.status(200).json({ ok: false, reason: `data.go.kr ${r.status}` });
    // 키가 틀리면 JSON 대신 XML 오류가 온다 → 아래 JSON 읽기에서 실패로 처리
    const data = JSON.parse(await r.text());
    let items = data?.response?.body?.items?.item ?? [];
    if (!Array.isArray(items)) items = [items];
    const days = items
      .filter((i) => i && i.isHoliday === 'Y')
      .map((i) => ({ date: String(i.locdate), name: String(i.dateName || '휴일').slice(0, 12) }));
    // 공휴일은 자주 바뀌지 않는다 → 하루 동안 저장해 두고 다시 묻지 않는다
    res.setHeader('cache-control', 's-maxage=86400');
    return res.status(200).json({ ok: true, days });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'error' });
  }
};
