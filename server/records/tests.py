import json
import uuid
from urllib.parse import parse_qs, urlparse
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings
from .models import GameRecord

class SetupTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.state = str(uuid.uuid4())

    def test_cookie_scope_and_google_login(self):
        response = self.client.get('/chessmine/auth/start', {'state': self.state})
        self.assertEqual(settings.SESSION_COOKIE_PATH, '/chessmine/')
        self.assertEqual(self.client.cookies['chessmine_csrf']['path'], '/chessmine/')
        self.assertContains(response, '/chessmine/accounts/google/login/')
        token = self.client.cookies['chessmine_csrf'].value
        response = self.client.post('/chessmine/accounts/google/login/', {'csrfmiddlewaretoken': token})
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response['Location'].startswith('https://accounts.google.com/'))

    def test_only_public_pages_are_served(self):
        self.assertEqual(self.client.get('/chessmine/').status_code, 200)
        self.assertEqual(self.client.get('/chessmine/privacy.html').status_code, 200)
        self.assertEqual(self.client.get('/chessmine/3d_minesweeper.html').status_code, 404)
        self.assertEqual(self.client.get('/chessmine/accounts/signup/').status_code, 404)

    @override_settings(ALLOWED_HOSTS=['jsaur.duckdns.org'])
    def test_google_callback_uses_https_game_path(self):
        self.client.get('/chessmine/auth/start', {'state': self.state}, secure=True, HTTP_HOST='jsaur.duckdns.org')
        token = self.client.cookies['chessmine_csrf'].value
        response = self.client.post('/chessmine/accounts/google/login/', {'csrfmiddlewaretoken': token}, secure=True, HTTP_HOST='jsaur.duckdns.org', HTTP_ORIGIN='https://jsaur.duckdns.org')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(parse_qs(urlparse(response['Location']).query)['redirect_uri'], ['https://jsaur.duckdns.org/chessmine/accounts/google/login/callback/'])

class CrossOriginTests(TestCase):
    origin = 'https://sihoo7005.github.io'
    def setUp(self):
        self.alice = get_user_model().objects.create_user(username='alice')
        self.bob = get_user_model().objects.create_user(username='bob')
        self.client = Client(enforce_csrf_checks=True)
        self.state = str(uuid.uuid4())
        self.payload = {'clientId': str(uuid.uuid4()), 'mode': 'no-guess', 'size': 3, 'mines': 2,
                        'weights': {'K': 7, 'R': 1, 'B': 1, 'Q': 1, 'N': 1}, 'result': 'lost', 'durationMs': 1234}

    def issue_token(self, user):
        import re
        self.client.force_login(user)
        response = self.client.get('/chessmine/auth/bridge', {'state': self.state})
        self.assertEqual(response.status_code, 200)
        match = re.search(r'"code": "([A-Za-z0-9_-]+)"', response.content.decode())
        self.assertIsNotNone(match)
        code = match.group(1)
        response = self.client.post('/chessmine/api/cross/exchange', json.dumps({'code': code}), content_type='application/json', HTTP_ORIGIN=self.origin)
        self.assertEqual(response.status_code, 200)
        repeated = self.client.post('/chessmine/api/cross/exchange', json.dumps({'code': code}), content_type='application/json', HTTP_ORIGIN=self.origin)
        self.assertEqual(repeated.status_code, 401, 'A login ticket may be used only once')
        return response.json()['token']

    def test_cors_and_cookie_cannot_authorize(self):
        self.client.force_login(self.alice)
        response = self.client.get('/chessmine/api/cross/session', HTTP_ORIGIN=self.origin)
        self.assertEqual(response.status_code, 401, 'A browser cookie must not authenticate the cross-origin API')
        self.assertEqual(response['Access-Control-Allow-Origin'], self.origin)
        self.assertEqual(self.client.options('/chessmine/api/cross/records', HTTP_ORIGIN='https://attacker.example').status_code, 403)
        self.assertEqual(self.client.options('/chessmine/api/cross/records', HTTP_ORIGIN=self.origin).status_code, 204)

    def test_token_authentication_isolation_and_revocation(self):
        alice_token = self.issue_token(self.alice)
        response = self.client.post('/chessmine/api/cross/records', json.dumps(self.payload), content_type='application/json', HTTP_ORIGIN=self.origin, HTTP_AUTHORIZATION=f'Bearer {alice_token}')
        self.assertEqual(response.status_code, 201)
        self.assertIn('no-store', response['Cache-Control'])
        bob_token = self.issue_token(self.bob)
        response = self.client.get('/chessmine/api/cross/records', HTTP_ORIGIN=self.origin, HTTP_AUTHORIZATION=f'Bearer {bob_token}')
        self.assertEqual(response.json()['records'], [])
        self.assertEqual(self.client.post('/chessmine/api/cross/logout', HTTP_ORIGIN=self.origin, HTTP_AUTHORIZATION=f'Bearer {alice_token}').status_code, 200)
        self.assertEqual(self.client.get('/chessmine/api/cross/session', HTTP_ORIGIN=self.origin, HTTP_AUTHORIZATION=f'Bearer {alice_token}').status_code, 401)

    def test_hint_credits_are_per_account_and_promo_is_one_use(self):
        from datetime import timedelta
        from django.utils import timezone
        from .models import HintBalance
        alice = {'HTTP_ORIGIN': self.origin, 'HTTP_AUTHORIZATION': 'Bearer ' + self.issue_token(self.alice)}
        bob = {'HTTP_ORIGIN': self.origin, 'HTTP_AUTHORIZATION': 'Bearer ' + self.issue_token(self.bob)}
        url = '/chessmine/api/cross/'
        self.assertEqual(self.client.get(url + 'hints', **alice).json()['credits'], 0)
        self.assertEqual(self.client.post(url + 'hint-use', **alice).status_code, 409)
        ticket = self.client.post(url + 'hint-start', **alice).json()['ticket']
        payload = json.dumps({'ticket': ticket})
        self.assertEqual(self.client.post(url + 'hint-claim', payload, content_type='application/json', **alice).status_code, 400)
        self.assertEqual(self.client.post(url + 'hint-claim', payload, content_type='application/json', **bob).status_code, 400)
        HintBalance.objects.filter(user=self.alice).update(promo_ready_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.client.post(url + 'hint-claim', payload, content_type='application/json', **alice).json()['credits'], 3)
        self.assertEqual(self.client.post(url + 'hint-start', **alice).status_code, 409, 'A promotion starts only when no credits remain')
        self.assertEqual(self.client.post(url + 'hint-claim', payload, content_type='application/json', **alice).status_code, 400)
        alice_other = {'HTTP_ORIGIN': self.origin, 'HTTP_AUTHORIZATION': 'Bearer ' + self.issue_token(self.alice)}
        self.assertEqual(self.client.get(url + 'hints', **alice_other).json()['credits'], 3, 'The same account shares credits across sessions')
        self.assertEqual(self.client.get(url + 'hints', **bob).json()['credits'], 0)
        for remaining in (2, 1, 0):
            self.assertEqual(self.client.post(url + 'hint-use', **alice).json()['credits'], remaining)
        self.assertEqual(self.client.post(url + 'hint-use', **alice).status_code, 409)
        self.assertEqual(self.client.post(url + 'delete', **alice).status_code, 200)
        self.assertFalse(HintBalance.objects.filter(user_id=self.alice.pk).exists())

    @override_settings(PREMIUM_TEST_ENABLED=True)
    def test_premium_daily_hints_reset_in_utc_and_promo_bonus(self):
        from datetime import datetime, timedelta, timezone as utc
        from unittest.mock import patch
        from django.utils import timezone
        from .models import AccessToken, HintBalance
        from .views import token_digest
        token = self.issue_token(self.alice)
        AccessToken.objects.filter(digest=token_digest(token)).update(expires_at=timezone.now() + timedelta(days=370))
        auth = {'HTTP_ORIGIN': self.origin, 'HTTP_AUTHORIZATION': 'Bearer ' + token}
        url = '/chessmine/api/cross/'
        before = datetime(2026, 11, 12, 23, 59, 50, tzinfo=utc.utc)
        with patch('records.views.timezone.now', return_value=before):
            enable = self.client.post(url + 'premium-test', json.dumps({'enabled': True}), content_type='application/json', **auth)
            self.assertEqual(enable.json()['credits'], 15)
            self.assertTrue(enable.json()['premium'])
            self.assertEqual(self.client.post(url + 'hint-use', **auth).json()['credits'], 14)
            self.assertEqual(self.client.post(url + 'premium-test', json.dumps({'enabled': False}), content_type='application/json', **auth).json()['credits'], 0)
            self.assertEqual(self.client.post(url + 'premium-test', json.dumps({'enabled': True}), content_type='application/json', **auth).json()['credits'], 14, 'Toggling must not refill daily hints')
            HintBalance.objects.filter(user=self.alice).update(daily_credits=0)
            ticket = self.client.post(url + 'hint-start', **auth).json()['ticket']
        with patch('records.views.timezone.now', return_value=before + timedelta(seconds=4)):
            claim = self.client.post(url + 'hint-claim', json.dumps({'ticket': ticket}), content_type='application/json', **auth)
            self.assertEqual(claim.json()['credits'], 5, 'Premium promotion earns three plus two')
            self.assertEqual(self.client.post(url + 'hint-use', **auth).json()['credits'], 4)
        with patch('records.views.timezone.now', return_value=before + timedelta(seconds=11)):
            self.assertEqual(self.client.get(url + 'hints', **auth).json()['credits'], 19, 'UTC midnight adds fresh daily hints to saved hints')
            self.assertEqual(self.client.post(url + 'hint-use', **auth).json()['credits'], 18)
            balance = HintBalance.objects.get(user=self.alice)
            self.assertEqual((balance.daily_credits, balance.credits), (14, 4), 'Daily hints are spent before saved hints')
            self.assertEqual(self.client.get(url + 'hints', **auth).json()['credits'], 18, 'The daily allowance must not refill twice')
        with patch('records.views.timezone.now', return_value=before + timedelta(days=1, seconds=11)):
            self.assertEqual(self.client.get(url + 'hints', **auth).json()['credits'], 19, 'Unused daily hints must expire instead of carrying over')
            balance = HintBalance.objects.get(user=self.alice)
            self.assertEqual((balance.daily_credits, balance.credits), (15, 4))

    @override_settings(PREMIUM_TEST_ENABLED=False)
    def test_premium_test_switch_is_disabled_by_default(self):
        auth = {'HTTP_ORIGIN': self.origin, 'HTTP_AUTHORIZATION': 'Bearer ' + self.issue_token(self.alice)}
        response = self.client.post('/chessmine/api/cross/premium-test', json.dumps({'enabled': True}), content_type='application/json', **auth)
        self.assertEqual(response.status_code, 403)

    def test_invalid_record_and_account_deletion(self):
        token = self.issue_token(self.alice)
        auth = {'HTTP_ORIGIN': self.origin, 'HTTP_AUTHORIZATION': f'Bearer {token}'}
        for field, value in [('mode', 'unknown'), ('size', 11), ('mines', 27), ('durationMs', -1), ('result', 'pending'), ('clientId', 'bad'), ('weights', {'K': 0}), ('weights', {'K': 10**1000, 'R': 1, 'B': 1, 'Q': 1, 'N': 1})]:
            self.assertEqual(self.client.post('/chessmine/api/cross/records', json.dumps(dict(self.payload, **{field: value})), content_type='application/json', **auth).status_code, 400, field)
        self.assertEqual(self.client.post('/chessmine/api/cross/records', json.dumps(self.payload), content_type='application/json', **auth).status_code, 201)
        bob_token = self.issue_token(self.bob)
        bob_auth = {'HTTP_ORIGIN': self.origin, 'HTTP_AUTHORIZATION': f'Bearer {bob_token}'}
        self.assertEqual(self.client.post('/chessmine/api/cross/records', json.dumps(self.payload), content_type='application/json', **bob_auth).status_code, 201)
        self.assertEqual(self.client.post('/chessmine/api/cross/delete', **auth).status_code, 200)
        self.assertFalse(get_user_model().objects.filter(pk=self.alice.pk).exists())
        self.assertTrue(get_user_model().objects.filter(pk=self.bob.pk).exists())
        self.assertEqual(GameRecord.objects.count(), 1)
        self.assertEqual(len(self.client.get('/chessmine/api/cross/records', **bob_auth).json()['records']), 1)
        self.assertEqual(self.client.get('/chessmine/api/cross/session', **auth).status_code, 401)

    def test_invalid_and_expired_ticket(self):
        from datetime import timedelta
        from django.utils import timezone
        from .models import LoginTicket
        from .views import token_digest
        code = 'a' * 43
        LoginTicket.objects.create(digest=token_digest(code), user=self.alice, expires_at=timezone.now()-timedelta(seconds=1))
        response = self.client.post('/chessmine/api/cross/exchange', json.dumps({'code': code}), content_type='application/json', HTTP_ORIGIN=self.origin)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.client.get('/chessmine/auth/start', {'state': 'bad'}).status_code, 400)

    def test_oauth_callback_returns_to_original_popup_state(self):
        from unittest.mock import patch
        self.client.get('/chessmine/auth/start', {'state': self.state})
        csrf = self.client.cookies['chessmine_csrf'].value
        response = self.client.post('/chessmine/accounts/google/login/', {
            'csrfmiddlewaretoken': csrf, 'next': '/chessmine/auth/bridge?state=' + self.state,
        })
        google_state = parse_qs(urlparse(response['Location']).query)['state'][0]
        profile = {'id': 'google-test-user', 'email': 'test@example.invalid', 'verified_email': True,
                   'name': 'Test User', 'given_name': 'Test', 'family_name': 'User'}
        with patch('allauth.socialaccount.providers.google.views.GoogleOAuth2Adapter.get_access_token_data', return_value={'access_token': 'test'}), \
             patch('allauth.socialaccount.providers.google.views.GoogleOAuth2Adapter._fetch_user_info', return_value=profile):
            callback = self.client.get('/chessmine/accounts/google/login/callback/', {'state': google_state, 'code': 'test'})
        self.assertEqual(callback.status_code, 302)
        self.assertEqual(callback['Location'], '/chessmine/auth/bridge?state=' + self.state)
        bridge = self.client.get(callback['Location'])
        self.assertEqual(bridge.status_code, 200)
        self.assertContains(bridge, self.state)
        self.assertContains(bridge, self.origin)
        self.assertNotIn('_auth_user_id', self.client.session, 'Popup session must end after issuing the ticket')
        import re
        ticket = re.search(r'"code": "([A-Za-z0-9_-]+)"', bridge.content.decode()).group(1)
        exchanged = self.client.post('/chessmine/api/cross/exchange', json.dumps({'code': ticket}), content_type='application/json', HTTP_ORIGIN=self.origin)
        self.assertEqual(exchanged.status_code, 200)
        token = exchanged.json()['token']
        saved = self.client.post('/chessmine/api/cross/records', json.dumps(self.payload), content_type='application/json', HTTP_ORIGIN=self.origin, HTTP_AUTHORIZATION='Bearer ' + token)
        self.assertEqual(saved.status_code, 201)
        self.assertEqual(GameRecord.objects.count(), 1)
