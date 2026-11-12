# Google 로그인과 완료 기록 서버

게임 화면은 기존 GitHub Pages 주소에서 실행합니다. Oracle 서버는 `/chessmine/`에서 Google 로그인과 완료된 게임 기록만 처리합니다. 로그인한 사용자는 자신의 기록을 볼 수 있고 계정 및 기록을 삭제할 수 있습니다. 비로그인 게임과 진행 중인 게임은 저장하지 않습니다. 기록은 클라이언트에서 제출하므로 공식 순위나 부정행위 검증에 사용하면 안 됩니다. 백업의 삭제 정책은 별도로 정해야 합니다.

로그인은 별도 창에서 진행합니다. 서버는 Google 인증 후 2분 동안 한 번만 쓸 수 있는 코드를 게임 화면으로 전달합니다. 게임 화면은 이를 최대 12시간 유효한 인증 정보로 교환하고 브라우저 탭의 세션 저장소에 보관합니다. Oracle 서버의 API는 `https://sihoo7005.github.io` 출처와 인증 정보를 확인합니다. 계정의 인증 정보와 기록은 Oracle 서버의 SQLite에 저장됩니다.

## 확인할 사항

- 기존 Oracle Linux 서버에서 TCP 80은 VPN 중계에 사용 중입니다. TCP 80의 수신·전달·방화벽 규칙을 변경하지 않습니다. 기존 VPN 서비스를 중단하거나 설정을 덮어쓰지 않습니다.
- 외부에서 접근 가능한 TCP 443으로 HTTPS를 제공하고 `/chessmine/`만 내부 Gunicorn 서버로 전달하는 방안을 검토합니다. OCI와 서버 방화벽의 443 인바운드 및 전달 규칙을 먼저 확인해야 합니다. 내부 포트는 기존 서비스와 겹치지 않는 것을 확인한 뒤 선택합니다.
- TLS 인증서는 TCP 80을 사용하지 않는 방식이 필요합니다. TCP 443이 외부에서 접근 가능할 때 TLS-ALPN-01 방식을 검토할 수 있습니다. 웹 서버의 HTTP 리디렉션과 HTTP-01 인증을 켜서 포트 80을 차지하지 않도록 합니다.
- Google Cloud의 OAuth 동의 화면과 웹 애플리케이션 클라이언트를 만듭니다. 최종 도메인이 `jsaur.duckdns.org`이고 HTTPS가 준비됐다면 승인된 리디렉션 URI는 `https://jsaur.duckdns.org/chessmine/accounts/google/login/callback/`입니다. 실제 도메인과 포트가 다르면 URI도 정확히 맞춰야 합니다.
- 공개 전에 개인정보처리방침에 실제 운영자와 비공개 문의 연락처, 계정·기록의 보유 및 삭제 방법을 확정합니다. `privacy.html`은 아직 이 정보가 없는 초안입니다.
- Google 계정 인증 정보, 세션과 게임 기록이 SQLite에 저장됩니다. DB 파일과 백업을 웹 공개 경로 밖에 두고 접근을 제한합니다. VM 장애나 회수에 대비해 별도 백업을 구성합니다.

## Google 로그인 설정

Google Cloud는 Google 로그인을 이 게임에 연결하기 위한 설정 사이트입니다. 게임과 기록을 Google Cloud에 옮기는 것은 아닙니다.

1. [Google Cloud Console](https://console.cloud.google.com/)에 Google 계정으로 로그인하고 게임용 프로젝트를 만듭니다.
2. Google Auth Platform에서 시작하기를 선택하고 앱 이름과 Google이 요청하는 지원 이메일을 입력합니다. 대상은 사용할 계정 범위에 맞게 설정합니다.
3. 클라이언트 메뉴에서 OAuth 클라이언트를 만들고 유형으로 **웹 애플리케이션**을 선택합니다. 승인된 리디렉션 URI에 정확히 `https://jsaur.duckdns.org/chessmine/accounts/google/login/callback/`을 입력합니다.
4. 생성된 클라이언트 ID와 시크릿은 안전하게 보관합니다. 시크릿은 서버의 보호된 환경 변수에 직접 설정하며 저장소나 채팅에 공유하지 않습니다. Google 안내에 따라 생성 시 시크릿을 안전하게 보관합니다.
5. 테스트 상태라면 필요한 테스트 계정을 등록하고 실제 HTTPS 서버가 준비된 뒤 로그인과 기록 저장을 확인합니다. 공개 서비스에서는 도메인 확인, 개인정보처리방침 및 동의 화면이 실제 운영 내용과 일치해야 합니다.

참고: [Google 로그인 설정](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid?hl=ko) · [OAuth 클라이언트 관리](https://support.google.com/cloud/answer/15549257?hl=ko)

## 로컬 개발 검사

Python 3.12 이상을 사용합니다. 프로젝트 루트에서:

```sh
python -m venv .venv
.venv/bin/pip install -r server/requirements.txt
CHESSMINE_DEBUG=1 .venv/bin/python server/manage.py migrate
CHESSMINE_DEBUG=1 .venv/bin/python server/manage.py runserver 127.0.0.1:8000
```

브라우저에서 `http://127.0.0.1:8000/chessmine/`을 열어 서버 안내를 확인합니다. 실제 Google 로그인에는 테스트용 OAuth 클라이언트와 정확히 일치하는 리디렉션 URI가 필요합니다. GitHub Pages 연동과 실제 Google 인증은 배포 환경에서 별도로 검사해야 합니다. 클라이언트 ID와 시크릿은 환경 변수로만 전달합니다.

```sh
CHESSMINE_DEBUG=1 GOOGLE_OAUTH_CLIENT_ID=test GOOGLE_OAUTH_CLIENT_SECRET=test .venv/bin/python server/manage.py test records
node test_account.mjs
node test_no_guess_ui.mjs
node test_no_guess.mjs
```

여기의 `test`는 자동 검사에만 사용하는 더미 값입니다. 실제 Google 시크릿을 명령줄에 직접 입력하지 마세요.

## 운영 환경 변수

서비스 관리자나 보호된 환경 파일에서 다음 값을 설정합니다. **실제 비밀 값을 저장소나 채팅에 넣지 마세요.** `CHESSMINE_DEBUG`는 운영 환경에서 설정하지 않습니다.

- `CHESSMINE_SECRET_KEY`: 무작위로 생성한 Django 비밀 키
- `CHESSMINE_ALLOWED_HOSTS`: 실제 호스트 이름, 예: `jsaur.duckdns.org`
- `CHESSMINE_TRUSTED_ORIGINS`: 실제 HTTPS 출처, 예: `https://jsaur.duckdns.org`
- `CHESSMINE_DB_PATH`: 웹 공개 경로 밖의 SQLite 파일 경로
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`: Google OAuth 웹 클라이언트 인증 정보

Gunicorn은 **127.0.0.1에만** 바인딩합니다. Django는 앞단의 신뢰할 수 있는 웹 서버가 설정한 `X-Forwarded-Proto`를 받아 HTTPS를 판별하므로, Gunicorn을 외부에 직접 노출하면 안 됩니다. 앞단 웹 서버는 해당 헤더를 클라이언트 입력이 아닌 실제 연결 방식으로 덮어써야 합니다. 기존 서버 구성과 인증서를 확인하기 전에는 프록시 설정을 적용하지 마세요.

## TCP 80을 사용하지 않는 구성 초안

`Caddyfile.example`은 HTTP 리디렉션과 HTTP-01 인증을 끄고, TCP 443의 TLS-ALPN-01 인증을 사용하는 검토용 설정입니다. `chessmine.service.example`은 Gunicorn을 `127.0.0.1:18765`에만 바인딩하는 검토용 설정입니다. 둘 다 현재 서버에 설치하거나 적용하지 않았습니다.

적용 전에 OCI 및 서버 방화벽에서 TCP 443의 도달 가능성, TCP 443의 NAT 규칙, 내부 포트 18765의 사용 여부, `chessmine` 사용자와 파일 권한, Caddy 설정 검증 및 인증서 갱신을 확인해야 합니다. 기존 TCP 80과 VPN 규칙은 변경하지 않습니다. 기본 Caddy 서비스를 그대로 활성화하면 포트 80을 사용할 수 있으므로 검토 없이 활성화하지 마세요.
