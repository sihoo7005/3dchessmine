import json
import math
import uuid
from pathlib import Path
from django.contrib.auth import logout
from django.db import transaction
from django.http import FileResponse, Http404, HttpResponseNotAllowed, JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST
from .models import GameRecord

GAME_ROOT = Path(__file__).resolve().parents[2]
GAME_FILES = {'index.html', '3d_minesweeper.html', 'no_guess.html', 'no_guess_color.html', 'privacy.html', 'account.js'}

@require_GET
def game_file(request, name):
    if name not in GAME_FILES or not (GAME_ROOT / name).is_file():
        raise Http404
    return FileResponse((GAME_ROOT / name).open('rb'), content_type='application/javascript; charset=utf-8' if name.endswith('.js') else 'text/html; charset=utf-8')

@never_cache
@ensure_csrf_cookie
@require_GET
def session_info(request):
    user = request.user
    return JsonResponse({'authenticated': user.is_authenticated, 'name': user.get_full_name() or user.get_username() if user.is_authenticated else '', 'csrfToken': get_token(request)})

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

@never_cache
@require_POST
def delete_account(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'login_required'}, status=401)
    with transaction.atomic():
        user = request.user
        logout(request)
        user.delete()
    return JsonResponse({'deleted': True})
