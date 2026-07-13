# 세븐밸리 피킹

Next.js + Vercel + Supabase 기반 다중 사용자 모바일 피킹 웹앱입니다.

## 환경변수

.env.example 기준으로 Vercel과 로컬에 다음 값을 설정합니다.

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- APP_SESSION_SECRET

## 최초 관리자

Supabase migration 적용 후 앱에 접속하면 작업자가 0명일 때만 최초 관리자 설정 화면이 열립니다.

- ID: bkj0829
- PIN: 화면에서 직접 설정하는 4자리 숫자

## 검증

- npm install
- npm run parse:sample
- npm run build

샘플 XLS 기대값은 63품목, 총 72개, 위치 없음 3개입니다.
