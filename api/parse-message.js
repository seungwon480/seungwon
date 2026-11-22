// 메시지·포스터 사진에서 일정 읽기 (Gemini API). 키는 Vercel 환경 변수 GEMINI_API_KEY 에만 둔다.
// 아무 글이나 사진을 보내 내 사용량을 쓰지 못하게, 입력은 받지 않고 페이지에 있는 예시 메시지와 예시 포스터만 서버에서 읽는다.
const POSTER_PNG = require('./_poster.js');

const MESSAGE = '이번 주 금요일 저녁 6시에 신촌역 2번 출구 앞에서 보자! 저녁 먹고 영화 보러 가자';
// 소개 페이지 시연 화면의 "오늘" (일정 화면의 9월 30일 수요일)
const TODAY = '2026년 9월 30일 수요일';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const FORMAT =
  '키: title(짧은 제목), date("10월 2일 (금)" 꼴), time("18:00" 또는 "18:00–19:30" 꼴), place(장소). 모르는 값은 빈 문자열.';

function partsFor(source) {
  if (source === 'poster') {
    return [
      { text: `오늘은 ${TODAY}이다. 이 행사 포스터 사진에서 행사 일정을 하나 뽑아 JSON 으로만 답해라. 사전 신청 기간은 행사 날짜가 아니니 넣지 마라.\n${FORMAT}` },
      { inline_data: { mime_type: 'image/png', data: POSTER_PNG } },
    ];
  }
  return [{ text: `오늘은 ${TODAY}이다. 아래 메시지에서 약속 일정을 하나 뽑아 JSON 으로만 답해라.\n${FORMAT}\n메시지: ${MESSAGE}` }];
}

module.exports = async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(200).json({ ok: false, reason: 'no-key' });

  const source = req.query.source === 'poster' ? 'poster' : 'message';
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: partsFor(source) }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    });
    if (!r.ok) return res.status(200).json({ ok: false, reason: `gemini ${r.status}` });
    const data = await r.json();
    const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text || '').join('');
    const v = JSON.parse(text);
    const pick = (k) => (typeof v[k] === 'string' ? v[k].trim().slice(0, 40) : '');
    // 같은 예시라 결과가 같다 → 한 시간 동안 저장해 두고 다시 묻지 않는다 (무료 한도 보호)
    res.setHeader('cache-control', 's-maxage=3600');
    return res.status(200).json({ ok: true, title: pick('title'), date: pick('date'), time: pick('time'), place: pick('place') });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'error' });
  }
};
