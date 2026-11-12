import json
import uuid
from urllib.parse import parse_qs, urlparse
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings
from .models import GameRecord

class RecordsTests(TestCase):
    def setUp(self):
        self.alice = get_user_model().objects.create_user(username='alice')
        self.bob = get_user_model().objects.create_user(username='bob')
        self.client = Client(enforce_csrf_checks=True)
        self.payload = {'clientId': str(uuid.uuid4()), 'mode': 'no-guess-color', 'size': 6, 'mines': 35,
                        'weights': {'K': 7, 'R': 1, 'B': 1, 'Q': 1, 'N': 1}, 'result': 'won', 'durationMs': 65000}

    def token(self):
        return self.client.get('/chessmine/api/session').json()['csrfToken']

    def post(self, payload, token):
        return self.client.post('/chessmine/api/records', json.dumps(payload), content_type='application/json', HTTP_X_CSRFTOKEN=token)

    def test_cookie_scope_does_not_collide_with_other_services(self):
        self.client.force_login(self.alice)
        self.token()
        self.assertEqual(settings.SESSION_COOKIE_PATH, '/chessmine/')
        self.assertEqual(self.client.cookies['chessmine_csrf']['path'], '/chessmine/')

    def test_private_csrf_and_idempotent(self):
        self.assertEqual(self.client.get('/chessmine/api/records').status_code, 401)
        self.client.force_login(self.alice)
        token = self.token()
        self.assertEqual(self.client.post('/chessmine/api/records', json.dumps(self.payload), content_type='application/json').status_code, 403)
        self.assertEqual(self.post(self.payload, token).status_code, 201)
        self.assertEqual(self.post(self.payload, token).status_code, 200)
        self.assertEqual(GameRecord.objects.count(), 1)
        response = self.client.get('/chessmine/api/records')
        self.assertIn('no-store', response['Cache-Control'])
        self.assertEqual(len(response.json()['records']), 1)
        self.client.force_login(self.bob)
        self.assertEqual(self.client.get('/chessmine/api/records').json()['records'], [])

    def test_account_deletion_removes_only_own_records(self):
        self.client.force_login(self.alice)
        token = self.token()
        self.assertEqual(self.post(self.payload, token).status_code, 201)
        self.assertEqual(self.client.post('/chessmine/api/account/delete').status_code, 403)
        response = self.client.post('/chessmine/api/account/delete', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(get_user_model().objects.filter(pk=self.alice.pk).exists())
        self.assertTrue(get_user_model().objects.filter(pk=self.bob.pk).exists())
        self.assertEqual(GameRecord.objects.count(), 0)
        self.assertFalse(self.client.get('/chessmine/api/session').json()['authenticated'])

    def test_invalid_data_rejected(self):
        self.client.force_login(self.alice)
        token = self.token()
        for field, value in [('mode', 'unknown'), ('size', 11), ('mines', 216), ('durationMs', -1), ('result', 'pending'), ('clientId', 'bad'), ('weights', {'K': 0}), ('weights', {'K': 10**1000, 'R': 1, 'B': 1, 'Q': 1, 'N': 1})]:
            payload = dict(self.payload, **{field: value})
            self.assertEqual(self.post(payload, token).status_code, 400, field)
        self.assertEqual(GameRecord.objects.count(), 0)

    def test_only_game_files_are_served(self):
        self.assertEqual(self.client.get('/chessmine/3d_minesweeper.html').status_code, 200)
        self.assertEqual(self.client.get('/chessmine/account.js').status_code, 200)
        self.assertEqual(self.client.get('/chessmine/manage.py').status_code, 404)
        self.assertEqual(self.client.get('/chessmine/accounts/signup/').status_code, 404)

    def test_google_login_starts_with_csrf(self):
        token = self.token()
        response = self.client.post('/chessmine/accounts/google/login/', {'csrfmiddlewaretoken': token})
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response['Location'].startswith('https://accounts.google.com/'))

    @override_settings(ALLOWED_HOSTS=['jsaur.duckdns.org'])
    def test_google_callback_uses_https_game_path(self):
        token = self.client.get('/chessmine/api/session', secure=True, HTTP_HOST='jsaur.duckdns.org').json()['csrfToken']
        response = self.client.post('/chessmine/accounts/google/login/', {'csrfmiddlewaretoken': token}, secure=True, HTTP_HOST='jsaur.duckdns.org', HTTP_ORIGIN='https://jsaur.duckdns.org')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(parse_qs(urlparse(response['Location']).query)['redirect_uri'], ['https://jsaur.duckdns.org/chessmine/accounts/google/login/callback/'])
