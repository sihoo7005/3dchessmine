import json
import math
import uuid
from pathlib import Path
from django.contrib.auth import logout
from django.conf import settings
from django.db import transaction
from django.db.models import Case, F, IntegerField, Q, Value, When
from django.http import FileResponse, Http404, HttpResponse, HttpResponseNotAllowed, JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET
from .models import GameRecord, HintBalance

GAME_ROOT = Path(__file__).resolve().parents[2]
@require_GET
def service_home(request):
    return HttpResponse('<!doctype html><html lang="ko"><meta charset="utf-8"><title>3D 체스 지뢰찾기</title><p>이 서버는 3D 체스 지뢰찾기의 Google 로그인과 플레이 기록을 처리합니다.</p><p><a href="https://3dchessmine.pages.dev/">게임 열기</a> · <a href="/chessmine/privacy.html">개인정보처리방침</a></p></html>')

@require_GET
def privacy_file(request):
    path = GAME_ROOT / 'privacy.html'
    if not path.is_file():
        raise Http404
    return FileResponse(path.open('rb'), content_type='text/html; charset=utf-8')

def valid_record(data):
    if not isinstance(data, dict):
        return None
    try:
        client_id = uuid.UUID(data['clientId'])
        mode, size, mines, weights, result, duration = (data[k] for k in ('mode', 'size', 'mines', 'weights', 'result', 'durationMs'))
    except (KeyError, TypeError, ValueError, AttributeError):
        return None
    if mode not in ('normal', 'no-guess', 'no-guess-color') or result not in ('won', 'lost'):
        return None
    if type(size) is not int or not 3 <= size <= 10 or type(mines) is not int or not 1 <= mines < size ** 3:
        return None
    if type(duration) is not int or not 0 <= duration <= 30 * 24 * 60 * 60 * 1000:
        return None
    if not isinstance(weights, dict) or set(weights) != {'K', 'R', 'B', 'Q', 'N'}:
        return None
    if any(type(v) not in (int, float) or not 0 <= v <= 1000 or not math.isfinite(v) for v in weights.values()) or not any(weights.values()):
        return None
    return {'client_id': client_id, 'mode': mode, 'board_size': size, 'mine_count': mines, 'weights': weights, 'result': result, 'duration_ms': duration}

@never_cache
def records(request):
    if request.method not in ('GET', 'POST'):
        return HttpResponseNotAllowed(['GET', 'POST'])
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'login_required'}, status=401)
    if request.method == 'GET':
        rows = request.user.game_records.values('id', 'mode', 'board_size', 'mine_count', 'weights', 'result', 'duration_ms', 'finished_at')[:100]
        return JsonResponse({'records': list(rows)})
    if len(request.body) > 4096:
        return JsonResponse({'error': 'invalid_record'}, status=400)
    try:
        record = valid_record(json.loads(request.body))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
        record = None
    if record is None:
        return JsonResponse({'error': 'invalid_record'}, status=400)
    obj, created = GameRecord.objects.get_or_create(user=request.user, client_id=record.pop('client_id'), defaults=record)
    return JsonResponse({'id': str(obj.id), 'created': created}, status=201 if created else 200)

# Cross-origin API uses explicit bearer tokens and never authenticates with cookies.
import hashlib
import secrets
from datetime import timedelta, timezone as datetime_timezone
from urllib.parse import urlencode
from django.shortcuts import redirect
from django.utils import timezone
from django.utils.html import format_html
from django.views.decorators.csrf import csrf_exempt
from .models import AccessToken, LoginTicket

GAME_ORIGIN = 'https://sihoo7005.github.io'
GAME_ORIGINS = {GAME_ORIGIN, 'https://3dchessmine.pages.dev'}

def token_digest(token):
    return hashlib.sha256(token.encode('ascii')).hexdigest()

def valid_state(value):
    try:
        return str(uuid.UUID(value)) == value
    except (ValueError, TypeError, AttributeError):
        return False

@never_cache
@ensure_csrf_cookie
@require_GET
def cross_login_start(request):
    state = request.GET.get('state', '')
    origin = request.GET.get('origin', GAME_ORIGIN)
    if not valid_state(state) or origin not in GAME_ORIGINS:
        return HttpResponse('잘못된 로그인 요청입니다.', status=400)
    params = {'state': state}
    if origin != GAME_ORIGIN:
        params['origin'] = origin
    next_path = '/chessmine/auth/bridge?' + urlencode(params)
    if request.user.is_authenticated:
        return redirect(next_path)
    html = format_html('''<!doctype html><html lang="ko"><meta charset="utf-8"><title>Google 로그인</title>
        <p>Google 로그인으로 이동합니다.</p><form id="login" method="post" action="/chessmine/accounts/google/login/">
        <input type="hidden" name="csrfmiddlewaretoken" value="{}"><input type="hidden" name="next" value="{}">
        <button type="submit">Google로 계속</button></form><script>document.getElementById("login").submit()</script></html>''', get_token(request), next_path)
    return HttpResponse(html)

@never_cache
@require_GET
def cross_login_bridge(request):
    state = request.GET.get('state', '')
    origin = request.GET.get('origin', GAME_ORIGIN)
    if not request.user.is_authenticated or not valid_state(state) or origin not in GAME_ORIGINS:
        return HttpResponse('로그인을 완료하지 못했습니다. 게임 화면에서 다시 시도해 주세요.', status=400)
    code = secrets.token_urlsafe(32)
    now = timezone.now()
    LoginTicket.objects.filter(expires_at__lte=now).delete()
    LoginTicket.objects.create(digest=token_digest(code), user=request.user, expires_at=now + timedelta(minutes=2))
    logout(request)
    payload = json.dumps({'type': 'chessmine-login', 'code': code, 'state': state})
    # JSON values are generated server-side and contain only UUID and URL-safe characters.
    return HttpResponse(f'''<!doctype html><html lang="ko"><meta charset="utf-8"><title>로그인 완료</title>
      <p>게임 화면으로 돌아갑니다. 이 창이 닫히지 않으면 직접 닫아 주세요.</p>
      <script>if(window.opener){{window.opener.postMessage({payload}, {json.dumps(origin)});window.close();}}</script></html>''')

@csrf_exempt
@never_cache
def cross_api(request, action):
    origin = request.headers.get('Origin')
    if origin not in GAME_ORIGINS:
        return JsonResponse({'error': 'origin_not_allowed'}, status=403)
    def cors_response(response):
        response['Access-Control-Allow-Origin'] = origin
        response['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
        response['Vary'] = 'Origin'
        response['Cache-Control'] = 'no-store'
        return response
    if request.method == 'OPTIONS':
        return cors_response(HttpResponse(status=204))
    if action == 'exchange':
        if request.method != 'POST':
            return cors_response(HttpResponseNotAllowed(['POST']))
        try:
            data = json.loads(request.body) if len(request.body) <= 4096 else {}
            code = data.get('code', '') if isinstance(data, dict) else ''
            if not isinstance(code, str) or len(code) != 43 or not code.isascii():
                raise ValueError
        except (ValueError, UnicodeDecodeError, RecursionError):
            return cors_response(JsonResponse({'error': 'invalid_ticket'}, status=400))
        now = timezone.now()
        with transaction.atomic():
            ticket = LoginTicket.objects.select_for_update().filter(digest=token_digest(code), expires_at__gt=now).first()
            if not ticket:
                return cors_response(JsonResponse({'error': 'invalid_ticket'}, status=401))
            user = ticket.user
            if not ticket.delete()[0]:
                return cors_response(JsonResponse({'error': 'invalid_ticket'}, status=401))
            AccessToken.objects.filter(expires_at__lte=now).delete()
            token = secrets.token_urlsafe(32)
            AccessToken.objects.create(digest=token_digest(token), user=user, expires_at=now + timedelta(hours=12))
        return cors_response(JsonResponse({'token': token, 'name': user.get_full_name() or user.get_username(), 'userId': str(user.pk)}))
    header = request.headers.get('Authorization', '')
    token = header.removeprefix('Bearer ') if header.startswith('Bearer ') else ''
    if len(token) != 43 or not token.isascii():
        return cors_response(JsonResponse({'error': 'login_required'}, status=401))
    access = AccessToken.objects.select_related('user').filter(digest=token_digest(token), expires_at__gt=timezone.now()).first()
    if not access:
        return cors_response(JsonResponse({'error': 'login_required'}, status=401))
    if action in ('hints', 'hint-start', 'hint-claim', 'hint-use', 'premium-test'):
        if request.method != ('GET' if action == 'hints' else 'POST'):
            return cors_response(HttpResponseNotAllowed(['GET' if action == 'hints' else 'POST']))
        balance, _ = HintBalance.objects.get_or_create(user=access.user)
        if action == 'premium-test':
            if not settings.PREMIUM_TEST_ENABLED:
                return cors_response(JsonResponse({'error': 'test_disabled'}, status=403))
            try:
                data = json.loads(request.body) if len(request.body) <= 4096 else {}
                enabled = data.get('enabled') if isinstance(data, dict) else None
                if type(enabled) is not bool:
                    raise ValueError
            except (ValueError, UnicodeDecodeError, RecursionError):
                return cors_response(JsonResponse({'error': 'invalid_request'}, status=400))
            HintBalance.objects.filter(pk=balance.pk).update(test_premium=enabled)
        today = timezone.now().astimezone(datetime_timezone.utc).date()
        if settings.PREMIUM_TEST_ENABLED:
            HintBalance.objects.filter(pk=balance.pk, test_premium=True).filter(Q(daily_date__isnull=True) | ~Q(daily_date=today)).update(daily_date=today, daily_credits=15)
        if action == 'hint-start':
            ticket = secrets.token_urlsafe(32)
            eligible = HintBalance.objects.filter(pk=balance.pk, credits=0)
            if settings.PREMIUM_TEST_ENABLED:
                eligible = eligible.filter(Q(test_premium=False) | Q(daily_credits=0))
            if not eligible.update(promo_digest=token_digest(ticket), promo_ready_at=timezone.now() + timedelta(seconds=3)):
                return cors_response(JsonResponse({'error': 'hints_available'}, status=409))
            return cors_response(JsonResponse({'ticket': ticket}))
        if action == 'hint-claim':
            try:
                data = json.loads(request.body) if len(request.body) <= 4096 else {}
                ticket = data.get('ticket', '') if isinstance(data, dict) else ''
                if not isinstance(ticket, str) or len(ticket) != 43 or not ticket.isascii():
                    raise ValueError
            except (ValueError, UnicodeDecodeError, RecursionError):
                return cors_response(JsonResponse({'error': 'invalid_ticket'}, status=400))
            reward = Case(When(test_premium=True, then=Value(5)), default=Value(3), output_field=IntegerField()) if settings.PREMIUM_TEST_ENABLED else Value(3)
            updated = HintBalance.objects.filter(pk=balance.pk, promo_digest=token_digest(ticket), promo_ready_at__lte=timezone.now()).update(credits=F('credits') + reward, promo_digest='', promo_ready_at=None)
            if not updated:
                return cors_response(JsonResponse({'error': 'promo_not_ready'}, status=400))
        elif action == 'hint-use':
            used_daily = settings.PREMIUM_TEST_ENABLED and HintBalance.objects.filter(pk=balance.pk, test_premium=True, daily_date=today, daily_credits__gt=0).update(daily_credits=F('daily_credits') - 1)
            if not used_daily and not HintBalance.objects.filter(pk=balance.pk, credits__gt=0).update(credits=F('credits') - 1):
                return cors_response(JsonResponse({'error': 'no_hints'}, status=409))
        balance.refresh_from_db(fields=['credits', 'test_premium', 'daily_credits', 'daily_date'])
        premium = settings.PREMIUM_TEST_ENABLED and balance.test_premium
        return cors_response(JsonResponse({'credits': balance.credits + (balance.daily_credits if premium and balance.daily_date == today else 0), 'premium': premium, 'premiumTestAvailable': settings.PREMIUM_TEST_ENABLED}))
    if action == 'session' and request.method == 'GET':
        return cors_response(JsonResponse({'authenticated': True, 'name': access.user.get_full_name() or access.user.get_username(), 'userId': str(access.user.pk)}))
    if action == 'logout' and request.method == 'POST':
        access.delete()
        return cors_response(JsonResponse({'loggedOut': True}))
    if action == 'delete' and request.method == 'POST':
        access.user.delete()
        return cors_response(JsonResponse({'deleted': True}))
    if action == 'records':
        request.user = access.user
        return cors_response(records(request))
    return cors_response(JsonResponse({'error': 'not_found'}, status=404))
