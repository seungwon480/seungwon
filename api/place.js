// 장소 검색 (카카오 로컬 API). 키는 Vercel 환경 변수 KAKAO_REST_API_KEY 에만 둔다.
// 일정 등록의 장소 칸에서 [검색]을 눌렀을 때만 부른다. 검색어는 저장하지 않는다.
module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method' });
  // 이 페이지에서 부른 것만 받는다 (다른 사이트가 우리 키로 검색하지 못하게)
  if (req.headers['sec-fetch-site'] !== 'same-origin') return res.status(403).json({ ok: false, reason: 'origin' });

  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return res.status(200).json({ ok: false, reason: 'no-key' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const q = body && typeof body.q === 'string' ? body.q.trim().slice(0, 40) : '';
  if (q.length < 2) return res.status(400).json({ ok: false, reason: 'short' });

  const ask = async (kind) => {
    const r = await fetch(`https://dapi.kakao.com/v2/local/search/${kind}.json?size=5&query=${encodeURIComponent(q)}`, {
      headers: { Authorization: `KakaoAK ${key}` },
    });
    if (!r.ok) throw new Error(`kakao ${r.status}`);
    return (await r.json()).documents || [];
  };
  try {
    // 가게·건물 이름을 먼저 찾고, 없으면 주소로 찾는다
    let docs = await ask('keyword');
    if (!docs.length) docs = await ask('address');
    const results = docs.slice(0, 5).map((d) => ({
      name: String(d.place_name || d.address_name || '').slice(0, 40),
      address: String(d.road_address_name || d.address_name || '').slice(0, 80),
      x: Number(d.x) || 0,
      y: Number(d.y) || 0,
    })).filter((x) => x.name);
    return res.status(200).json({ ok: true, results });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'error' });
  }
};
