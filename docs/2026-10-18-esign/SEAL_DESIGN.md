# 샌드비 도장 도안·서체 — 2026-10-18

사용자가 제공한 도장 사진의 촘촘한 원형·타원·사각 글자와 회사 직인 구성을 반영했다. 예시 출처는 사용자가 알지 못한다고 답했으며, 사진에 나온 원본 상용 서체를 확보한 것으로 기록하지 않는다. 최신 범위와 검수는 [REFERENCE_SEALS.md](./REFERENCE_SEALS.md)를 따른다.

## 한글 도안 3종

- **둥근 도안체:** 굵은 둥근 획과 네모 칸을 채우는 한글 조합.
- **전서 도안체:** 비교적 가는 획과 길게 이어지는 곡선.
- **길상 도안체:** 중간 굵기와 굽은 획을 사용한 도안.

세 도안의 한글 윤곽은 직접 설계했다. 11,172음절을 조합한 WOFF2이며 이전의 선각 경로와 명조체를 사용하지 않는다. 사진의 원본과 동일하거나 정식 역사 전서체라고 주장하지 않는다. ASCII 95자는 기존 [Nanum Brush Script 공식 원본](https://github.com/google/fonts/tree/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl/nanumbrushscript)에서 추출·스케일 조정했다. 원 저작권 고지와 SIL OFL을 새 도안의 고지와 함께 `SendbSealDesigns-OFL.txt`에 포함했다.

## 한자 전서체

[CNS11643의 說文解字 공식 배포](https://www.cns11643.gov.tw/downloadList.jsp?ID=2&ID2=20)를 사용했다. 원본 SHA-256은 `e8501dc9747190936a222576c9b0b6f918ff335afa5696c3fda3acba1a9574e2`다. [공식 이용 안내](https://www.cns11643.gov.tw/pageView.jsp?ID=59&SN=&la=0&lang=tw)가 제공하는 SIL OFL 1.1을 선택해 원본 출처·CMEX 고지·OFL 전문을 `SendbSealCNS-OFL.txt`에 포함했다.

원본의 실제 윤곽이 있는 매핑 6,729자를 유지하고 글꼴 이름 변경·힌팅 제거·WOFF2 변환·128 코드포인트 묶음 분할을 수행했다. 입력된 글자의 묶음만 같은 출처에서 지연 로딩한다. 미지원 글자는 다른 폰트로 대체하거나 한글 이름을 임의 한자로 바꾸지 않는다.

## 재현과 배포

`scripts/prepare-esign-reference-fonts.py --cns-font <official-original.ttf>`를 저장소 루트에서 실행한다. 도구 의존성은 **fonttools[woff] 4.60.1**, **shapely 2.1.2**이며 설치/빌드/앱 실행에는 포함하지 않는다. 한글만 수정한 경우 `--reuse-cns`는 기존 묶음의 전체 해시를 검사한 뒤 재사용한다. 파일과 해시는 `public/esign/fonts/reference-seal-sources.json`에 기록한다.

글자와 선택 이미지의 PNG를 기존 이미지 예산 안으로 정규화해 완료 PDF에 보존한다. 음각 글자·여백은 투명하며 원본 문서의 바탕이 보인다. 새 DB·서버 도장 생성·AI 호출·발송 채널은 없다.
